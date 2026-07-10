import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisError, type RunOutcome } from "@/lib/analysis/runner";
import {
  analyzeSession,
  getAnalysisWithStaleness,
} from "@/lib/analysis/service";
import { getGlobalCache } from "@/lib/store/cache";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-svc-"));
  process.env.CLAUDE_DATA_DIR = path.join(baseDir, "live");
  process.env.CLAUDE_ARCHIVE_DIR = path.join(baseDir, "archive");
  process.env.CLAUDE_ANALYSIS_DIR = path.join(baseDir, "analysis");
  process.env.CLAUDE_SETTINGS_PATH = path.join(baseDir, "settings.json");
  getGlobalCache().clear();
});

afterEach(() => {
  delete process.env.CLAUDE_DATA_DIR;
  delete process.env.CLAUDE_ARCHIVE_DIR;
  delete process.env.CLAUDE_ANALYSIS_DIR;
  delete process.env.CLAUDE_SETTINGS_PATH;
  rmSync(baseDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const writeLive = (uuid: string, content: string) => {
  const dir = path.join(baseDir, "live", "-proj-a");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${uuid}.jsonl`);
  writeFileSync(filePath, content);
  return filePath;
};

const outcome: RunOutcome = {
  result: {
    summary: "要約。",
    goodPoints: ["良い点"],
    improvements: [{ point: "改善点", category: "その他" }],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
  costUSD: 0.02,
};

describe("analyzeSession", () => {
  it("分析を実行して保存し、メタデータを埋める", async () => {
    writeLive(UUID_A, basicJsonl);
    const run = vi.fn(async () => outcome);

    const saved = await analyzeSession(UUID_A, { run });

    expect(saved).not.toBeNull();
    expect(saved?.sessionId).toBe(UUID_A);
    expect(saved?.projectId).toBe("-proj-a");
    expect(saved?.model).toBe("haiku"); // デフォルト設定
    expect(saved?.sourceMtimeMs).toBeGreaterThan(0);
    expect(saved?.sourceSize).toBeGreaterThan(0);
    expect(saved?.sessionLastAt).toBe("2026-07-01T00:01:10.000Z");
    expect(saved?.costUSD).toBe(0.02);
    expect(
      existsSync(path.join(baseDir, "analysis", `${UUID_A}.json`)),
    ).toBe(true);

    // プロンプトにトランスクリプトが含まれる
    const prompt = run.mock.calls[0][0] as string;
    expect(prompt).toContain("[USER] 最初の質問");
    expect(prompt).toContain("[ASSISTANT] 回答1");
  });

  it("設定の analysisModel が run に渡る", async () => {
    writeLive(UUID_A, basicJsonl);
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({ retentionDays: null, analysisModel: "sonnet" }),
    );
    const run = vi.fn(async () => outcome);

    await analyzeSession(UUID_A, { run });
    expect(run.mock.calls[0][1]).toBe("sonnet");
  });

  it("存在しないセッションは null", async () => {
    const run = vi.fn(async () => outcome);
    expect(await analyzeSession(UUID_A, { run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("サイドチェーンのみのセッションは no-conversation", async () => {
    writeLive(
      UUID_B,
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: "サブ指示" },
        timestamp: "2026-07-01T00:00:00.000Z",
        isSidechain: true,
      })}\n${JSON.stringify({
        type: "assistant",
        requestId: "r1",
        message: { id: "m1", content: [{ type: "text", text: "サブ回答" }] },
        timestamp: "2026-07-01T00:00:05.000Z",
        isSidechain: true,
      })}\n`,
    );
    const run = vi.fn(async () => outcome);
    try {
      await analyzeSession(UUID_B, { run });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("no-conversation");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("実行中の再実行は in-flight エラー、完了後は再実行できる", async () => {
    writeLive(UUID_A, basicJsonl);
    let release: (v: RunOutcome) => void = () => {};
    const gate = new Promise<RunOutcome>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => gate);

    const first = analyzeSession(UUID_A, { run });
    // 1本目が run に到達するまで待つ
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    await expect(analyzeSession(UUID_A, { run })).rejects.toMatchObject({
      kind: "in-flight",
    });

    release(outcome);
    expect((await first)?.sessionId).toBe(UUID_A);

    // 完了後は再実行可能
    const again = await analyzeSession(UUID_A, { run });
    expect(again?.sessionId).toBe(UUID_A);
  });
});

describe("getAnalysisWithStaleness", () => {
  it("未分析は analysis null / isStale false", async () => {
    writeLive(UUID_A, basicJsonl);
    expect(await getAnalysisWithStaleness(UUID_A)).toEqual({
      analysis: null,
      isStale: false,
    });
  });

  it("分析済み・未変更は isStale false", async () => {
    writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });
    const got = await getAnalysisWithStaleness(UUID_A);
    expect(got?.analysis?.sessionId).toBe(UUID_A);
    expect(got?.isStale).toBe(false);
  });

  it("分析後にファイルが変わると isStale true", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });

    writeFileSync(filePath, `${basicJsonl}\n`);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);

    const got = await getAnalysisWithStaleness(UUID_A);
    expect(got?.isStale).toBe(true);
  });

  it("セッションJSONLが消滅しても分析があれば isStale true で返す", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });
    rmSync(filePath);
    getGlobalCache().clear();

    const got = await getAnalysisWithStaleness(UUID_A);
    expect(got?.analysis?.sessionId).toBe(UUID_A);
    expect(got?.isStale).toBe(true);
  });

  it("セッションも分析も無ければ null", async () => {
    expect(await getAnalysisWithStaleness(UUID_A)).toBeNull();
  });
});
