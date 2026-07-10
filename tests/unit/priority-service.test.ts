import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPriorityAnalysis,
  isPriorityAnalysisInflight,
  runPriorityAnalysis,
} from "@/lib/analysis/priority-service";
import type { PriorityAnalysisResult } from "@/lib/analysis/priority-types";
import { AnalysisError, type RunJsonOutcome } from "@/lib/analysis/runner";
import { writeAnalysis } from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";

let baseDir: string;
let analysisDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-prio-"));
  analysisDir = path.join(baseDir, "analysis");
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
});

afterEach(() => {
  delete process.env.CLAUDE_ANALYSIS_DIR;
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
): StoredAnalysis => ({
  schemaVersion: 1,
  sessionId: uuidOf(n),
  projectId: "-proj-a",
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
    const run = vi.fn(async () => okOutcome);

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
    const run = vi.fn(async () => okOutcome);

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

describe("getPriorityAnalysis", () => {
  it("未保存は null", async () => {
    expect(await getPriorityAnalysis()).toBeNull();
  });
});
