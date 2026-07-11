import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPriorityAnalysis,
  isPriorityAnalysisInflight,
  runPriorityAnalysis,
} from "@/lib/analysis/priority-service";
import type { PriorityAnalysisResult } from "@/lib/analysis/priority-types";
import {
  AnalysisError,
  type RunJsonOptions,
  type RunJsonOutcome,
} from "@/lib/analysis/runner";
import { writeAnalysis } from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";

let baseDir: string;
let analysisDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-prio-"));
  analysisDir = path.join(baseDir, "analysis");
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
  process.env.CLAUDE_SETTINGS_PATH = path.join(baseDir, "settings.json");
});

afterEach(() => {
  delete process.env.CLAUDE_ANALYSIS_DIR;
  delete process.env.CLAUDE_SETTINGS_PATH;
  rmSync(baseDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const uuidOf = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const mkAnalysis = (
  n: number,
  lastAt: string,
  point: string,
  category = "タスク分割",
  projectId = "-proj-a",
): StoredAnalysis => ({
  schemaVersion: 1,
  sessionId: uuidOf(n),
  projectId,
  analyzedAt: lastAt,
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: lastAt,
  costUSD: 0.01,
  result: {
    summary: "要約。",
    goodPoints: ["良い点"],
    improvements: [
      { point, category: category as StoredAnalysis["result"]["improvements"][number]["category"] },
    ],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

const priorityResult: PriorityAnalysisResult = {
  pickedIssues: [
    {
      point: "タスクを小さく分割すると良い",
      category: "タスク分割",
      reason: "頻出のため",
      actions: ["依頼を3ステップに分ける"],
    },
  ],
  summary: "全体講評。",
};

const okOutcome: RunJsonOutcome = { result: priorityResult, costUSD: 0.1 };

describe("runPriorityAnalysis", () => {
  it("保存済み分析が0件なら no-analyses エラー", async () => {
    const run = vi.fn(async () => okOutcome);
    try {
      await runPriorityAnalysis("sonnet", { run });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("no-analyses");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("プロンプトに改善点・カテゴリ・優先指示が含まれ、モデルが渡る", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    await writeAnalysis(
      analysisDir,
      mkAnalysis(2, "2026-07-02T00:00:00.000Z", "改善B", "その他"),
    );
    const run = vi.fn(async (_prompt: string, _options: RunJsonOptions) => okOutcome);

    await runPriorityAnalysis("opus", { run });

    const [prompt, options] = run.mock.calls[0];
    expect(prompt).toContain("改善A");
    expect(prompt).toContain("改善B");
    expect(prompt).toContain("タスク分割");
    expect(prompt).toContain("優先");
    expect(options.model).toBe("opus");
  });

  it("sessionLastAt 降順で最新20件のみ入力に使う", async () => {
    for (let n = 1; n <= 21; n++) {
      const day = String(n).padStart(2, "0");
      await writeAnalysis(
        analysisDir,
        mkAnalysis(n, `2026-06-${day}T00:00:00.000Z`, n === 1 ? "最古の改善" : `改善${n}`),
      );
    }
    const run = vi.fn(async (_prompt: string) => okOutcome);

    const saved = await runPriorityAnalysis("haiku", { run });

    const prompt = run.mock.calls[0][0];
    expect(prompt).not.toContain("最古の改善");
    expect(prompt).toContain("改善21");
    expect(prompt).toContain("改善2");
    expect(saved.analyzedSessionCount).toBe(20);
  });

  it("結果を priority-analysis.json に永続化しメタデータを埋める", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    const run = vi.fn(async () => okOutcome);

    const saved = await runPriorityAnalysis("sonnet", { run });

    expect(saved.model).toBe("sonnet");
    expect(saved.analyzedSessionCount).toBe(1);
    expect(saved.costUSD).toBe(0.1);
    expect(saved.result.summary).toBe("全体講評。");
    expect(existsSync(path.join(analysisDir, "priority-analysis.json"))).toBe(true);
    expect((await getPriorityAnalysis())?.model).toBe("sonnet");
  });

  it("スキーマ不適合の結果は invalid-output", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    const run = vi.fn(async (): Promise<RunJsonOutcome> => ({
      result: { bad: true },
      costUSD: null,
    }));

    await expect(runPriorityAnalysis("haiku", { run })).rejects.toMatchObject({
      kind: "invalid-output",
    });
  });

  it("実行中の再実行は in-flight、完了後は再実行できる", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    let release: (v: RunJsonOutcome) => void = () => {};
    const gate = new Promise<RunJsonOutcome>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => gate);

    const first = runPriorityAnalysis("haiku", { run });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    expect(isPriorityAnalysisInflight()).toBe(true);
    await expect(runPriorityAnalysis("haiku", { run })).rejects.toMatchObject({
      kind: "in-flight",
    });

    release(okOutcome);
    await first;

    expect(isPriorityAnalysisInflight()).toBe(false);
    const again = await runPriorityAnalysis("haiku", { run });
    expect(again.result.summary).toBe("全体講評。");
  });
});

describe("runPriorityAnalysis（プロジェクト別）", () => {
  it("projectId 指定で該当プロジェクトの分析のみ入力にし、プロジェクト別ファイルへ保存する", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "Aの改善"));
    await writeAnalysis(
      analysisDir,
      mkAnalysis(2, "2026-07-02T00:00:00.000Z", "Bの改善", "その他", "-proj-b"),
    );
    const run = vi.fn(async (_prompt: string) => okOutcome);

    const saved = await runPriorityAnalysis("sonnet", { run }, "-proj-a");

    const prompt = run.mock.calls[0][0];
    expect(prompt).toContain("Aの改善");
    expect(prompt).not.toContain("Bの改善");
    expect(saved.projectId).toBe("-proj-a");
    expect(saved.analyzedSessionCount).toBe(1);
    expect(
      existsSync(path.join(analysisDir, "priority-analysis.-proj-a.json")),
    ).toBe(true);
    // グローバルの保存先は書かれない
    expect(existsSync(path.join(analysisDir, "priority-analysis.json"))).toBe(false);
    expect((await getPriorityAnalysis("-proj-a"))?.projectId).toBe("-proj-a");
    expect(await getPriorityAnalysis()).toBeNull();
  });

  it("該当プロジェクトの分析が0件なら no-analyses", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "Aの改善"));
    const run = vi.fn(async () => okOutcome);

    await expect(
      runPriorityAnalysis("haiku", { run }, "-proj-zzz"),
    ).rejects.toMatchObject({ kind: "no-analyses" });
    expect(run).not.toHaveBeenCalled();
  });

  it("in-flight はプロジェクト別（同一のみブロック・グローバルや別プロジェクトは並行可）", async () => {
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "Aの改善"));
    await writeAnalysis(
      analysisDir,
      mkAnalysis(2, "2026-07-02T00:00:00.000Z", "Bの改善", "その他", "-proj-b"),
    );
    let releaseA: (v: RunJsonOutcome) => void = () => {};
    const gateA = new Promise<RunJsonOutcome>((resolve) => {
      releaseA = resolve;
    });
    const runGated = vi.fn(() => gateA);

    const first = runPriorityAnalysis("haiku", { run: runGated }, "-proj-a");
    await vi.waitFor(() => expect(runGated).toHaveBeenCalledOnce());

    expect(isPriorityAnalysisInflight("-proj-a")).toBe(true);
    expect(isPriorityAnalysisInflight()).toBe(false);
    expect(isPriorityAnalysisInflight("-proj-b")).toBe(false);

    await expect(
      runPriorityAnalysis("haiku", { run: runGated }, "-proj-a"),
    ).rejects.toMatchObject({ kind: "in-flight" });

    // 別プロジェクト・グローバルはブロックされない
    const runOk = vi.fn(async () => okOutcome);
    await runPriorityAnalysis("haiku", { run: runOk }, "-proj-b");
    await runPriorityAnalysis("haiku", { run: runOk });
    expect(runOk).toHaveBeenCalledTimes(2);

    releaseA(okOutcome);
    await first;
    expect(isPriorityAnalysisInflight("-proj-a")).toBe(false);
  });
});

describe("runPriorityAnalysis: プロバイダ解決", () => {
  it("model 省略時は設定の claude モデルを使い、provider を保存する", async () => {
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({ providers: { claude: { model: "sonnet" } } }),
    );
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    const run = vi.fn(async (_prompt: string, _options: { model?: string }) => okOutcome);

    const saved = await runPriorityAnalysis(undefined, { run });

    expect(run.mock.calls[0][1].model).toBe("sonnet");
    expect(saved.model).toBe("sonnet");
    expect(saved.provider).toBe("claude");
  });

  it("非 claude プロバイダでは model 引数を無視して設定モデルを使う", async () => {
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({
        analysisProvider: "lmstudio",
        providers: {
          lmstudio: { model: "qwen3", baseUrl: "http://localhost:1234/v1" },
        },
      }),
    );
    await writeAnalysis(analysisDir, mkAnalysis(1, "2026-07-01T00:00:00.000Z", "改善A"));
    const run = vi.fn(async (_prompt: string, _options: { model?: string }) => okOutcome);

    const saved = await runPriorityAnalysis("opus", { run });

    expect(run.mock.calls[0][1].model).toBe("qwen3");
    expect(saved.model).toBe("qwen3");
    expect(saved.provider).toBe("lmstudio");
  });
});

describe("getPriorityAnalysis", () => {
  it("未保存は null", async () => {
    expect(await getPriorityAnalysis()).toBeNull();
    expect(await getPriorityAnalysis("-proj-a")).toBeNull();
  });
});
