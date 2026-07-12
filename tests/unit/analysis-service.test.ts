import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
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
  getAnalysisStatusMap,
  getAnalysisWithStaleness,
  isAnalysisInflight,
} from "@/lib/analysis/service";
import { isSessionMetrics } from "@/lib/analysis/metrics";
import { writeQueue } from "@/lib/analysis/store";
import { getGlobalCache } from "@/lib/store/cache";
import { mkAnalysisResult, mkLegacyStoredJson } from "./helpers";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);
const metricsJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/metrics-session.jsonl", import.meta.url)),
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
  result: mkAnalysisResult(),
  costUSD: 0.02,
};

describe("analyzeSession", () => {
  it("分析を実行して保存し、メタデータを埋める", async () => {
    writeLive(UUID_A, basicJsonl);
    const run = vi.fn(async (_prompt: string, _options: { model: string }) => outcome);

    const saved = await analyzeSession(UUID_A, { run });

    expect(saved).not.toBeNull();
    expect(saved?.sessionId).toBe(UUID_A);
    expect(saved?.projectId).toBe("-proj-a");
    expect(saved?.model).toBe("haiku"); // デフォルト設定
    expect(saved?.provider).toBe("claude"); // デフォルトプロバイダ
    expect(saved?.sourceMtimeMs).toBeGreaterThan(0);
    expect(saved?.sourceSize).toBeGreaterThan(0);
    expect(saved?.sessionLastAt).toBe("2026-07-01T00:01:10.000Z");
    expect(saved?.costUSD).toBe(0.02);
    expect(
      existsSync(path.join(baseDir, "analysis", `${UUID_A}.json`)),
    ).toBe(true);

    // プロンプトにトランスクリプトが含まれる
    const prompt = run.mock.calls[0][0];
    expect(prompt).toContain("[USER] 最初の質問");
    expect(prompt).toContain("[ASSISTANT] 回答1");
  });

  it("schemaVersion 3 で定量メトリクスを算出・保存し、プロンプトにも注入する", async () => {
    writeLive(UUID_A, metricsJsonl);
    const run = vi.fn(async (_prompt: string) => outcome);

    const saved = await analyzeSession(UUID_A, { run });

    expect(saved?.schemaVersion).toBe(3);
    expect(isSessionMetrics(saved?.metrics)).toBe(true);
    expect(saved?.metrics.editOpCount).toBe(4);
    expect(saved?.metrics.interruptionCount).toBe(2);
    expect(saved?.metrics.testFailCount).toBe(1);

    const prompt = run.mock.calls[0][0];
    expect(prompt).toContain("=== 定量メトリクス");
    expect(prompt).toContain("推定変更行数");
    expect(prompt).toContain("=== セッション記録 ===");
  });

  it("設定のモデルが run の options に渡る（旧 analysisModel からの移行）", async () => {
    writeLive(UUID_A, basicJsonl);
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({ retentionDays: null, analysisModel: "sonnet" }),
    );
    const run = vi.fn(async (_prompt: string, _options: { model: string }) => outcome);

    await analyzeSession(UUID_A, { run });
    expect(run.mock.calls[0][1].model).toBe("sonnet");
  });

  it("アクティブプロバイダの設定がメタデータと run 引数に反映される", async () => {
    writeLive(UUID_A, basicJsonl);
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({
        analysisProvider: "lmstudio",
        providers: {
          lmstudio: { model: "qwen3", baseUrl: "http://localhost:1234/v1" },
        },
      }),
    );
    const run = vi.fn(
      async (
        _prompt: string,
        _options: { model: string },
        _settings: { analysisProvider: string },
      ) => outcome,
    );

    const saved = await analyzeSession(UUID_A, { run });
    expect(saved?.provider).toBe("lmstudio");
    expect(saved?.model).toBe("qwen3");
    expect(run.mock.calls[0][1].model).toBe("qwen3");
    expect(run.mock.calls[0][2].analysisProvider).toBe("lmstudio");
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

describe("旧 v1 分析データの移行（要再分析扱い）", () => {
  const writeLegacy = (sessionId: string) => {
    const dir = path.join(baseDir, "analysis");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${sessionId}.json`),
      JSON.stringify(mkLegacyStoredJson(sessionId)),
    );
  };

  it("getAnalysisWithStaleness は analysis null / isStale true を返す", async () => {
    writeLive(UUID_A, basicJsonl);
    writeLegacy(UUID_A);
    expect(await getAnalysisWithStaleness(UUID_A)).toEqual({
      analysis: null,
      isStale: true,
    });
  });

  it("getAnalysisStatusMap は stale として一覧に出す（再分析導線に乗せる）", async () => {
    writeLive(UUID_A, basicJsonl);
    writeLegacy(UUID_A);
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("stale");
  });

  it("v1 を再分析すると v3 で上書きされ analyzed に戻る", async () => {
    writeLive(UUID_A, basicJsonl);
    writeLegacy(UUID_A);
    await analyzeSession(UUID_A, { run: async () => outcome });
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzed");
    const got = await getAnalysisWithStaleness(UUID_A);
    expect(got?.analysis?.schemaVersion).toBe(3);
    expect(got?.isStale).toBe(false);
  });
});

describe("getAnalysisStatusMap / isAnalysisInflight", () => {
  it("分析が無ければ空の Map", async () => {
    writeLive(UUID_A, basicJsonl);
    expect((await getAnalysisStatusMap()).size).toBe(0);
  });

  it("分析済み・未変更は analyzed", async () => {
    writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzed");
  });

  it("分析後にファイルが変わると stale", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });

    writeFileSync(filePath, `${basicJsonl}\n`);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);

    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("stale");
  });

  it("セッションファイルが消滅したら stale", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });
    rmSync(filePath);
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("stale");
  });

  it("archive 側へ移動したセッションも解決できる", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });

    const archiveDir = path.join(baseDir, "archive", "-proj-a");
    mkdirSync(archiveDir, { recursive: true });
    renameSync(filePath, path.join(archiveDir, `${UUID_A}.jsonl`));

    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzed");
  });

  it("分析実行中は analyzing が最優先、未分析セッションも analyzing", async () => {
    writeLive(UUID_A, basicJsonl);
    writeLive(UUID_B, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome }); // A は分析済みにする

    let releaseA: (v: RunOutcome) => void = () => {};
    let releaseB: (v: RunOutcome) => void = () => {};
    const runA = vi.fn(
      () =>
        new Promise<RunOutcome>((resolve) => {
          releaseA = resolve;
        }),
    );
    const runB = vi.fn(
      () =>
        new Promise<RunOutcome>((resolve) => {
          releaseB = resolve;
        }),
    );
    const pendingA = analyzeSession(UUID_A, { run: runA });
    const pendingB = analyzeSession(UUID_B, { run: runB });
    await vi.waitFor(() => expect(runA).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runB).toHaveBeenCalledOnce());

    expect(isAnalysisInflight(UUID_A)).toBe(true);
    const map = await getAnalysisStatusMap();
    expect(map.get(UUID_A)).toBe("analyzing");
    expect(map.get(UUID_B)).toBe("analyzing");

    releaseA(outcome);
    releaseB(outcome);
    await Promise.all([pendingA, pendingB]);

    expect(isAnalysisInflight(UUID_A)).toBe(false);
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzed");
  });
});

describe("getAnalysisStatusMap: キュー待機の反映", () => {
  const seedQueuePending = (sessionId: string) =>
    writeQueue(path.join(baseDir, "analysis"), {
      schemaVersion: 1,
      paused: false,
      items: [
        { sessionId, state: "pending", enqueuedAt: "2026-07-10T00:00:00.000Z" },
      ],
    });

  it("キュー pending は queued（未分析セッションでも）", async () => {
    writeLive(UUID_B, basicJsonl);
    await seedQueuePending(UUID_B);
    expect((await getAnalysisStatusMap()).get(UUID_B)).toBe("queued");
  });

  it("分析済み・stale より queued を優先する", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzed");

    await seedQueuePending(UUID_A);
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("queued");

    // stale 化しても queued のまま（これから起きることを優先表示）
    writeFileSync(filePath, `${basicJsonl}\n`);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("queued");
  });

  it("in-flight は queued より優先で analyzing", async () => {
    writeLive(UUID_A, basicJsonl);
    await seedQueuePending(UUID_A);

    let release: (v: RunOutcome) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<RunOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const pending = analyzeSession(UUID_A, { run });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    expect((await getAnalysisStatusMap()).get(UUID_A)).toBe("analyzing");

    release(outcome);
    await pending;
  });
});

describe("マルチソース: Codex セッションの分析", () => {
  const CODEX_UUID = "019f54b2-2728-71c0-919e-e3b8edf47689";
  const codexJsonl = readFileSync(
    fileURLToPath(new URL("../fixtures/codex-basic-rollout.jsonl", import.meta.url)),
    "utf8",
  );

  const writeCodexLive = () => {
    const dir = path.join(baseDir, "codex-live", "2026", "07", "12");
    mkdirSync(dir, { recursive: true });
    process.env.CODEX_DATA_DIR = path.join(baseDir, "codex-live");
    const filePath = path.join(dir, `rollout-2026-07-12T05-00-06-${CODEX_UUID}.jsonl`);
    writeFileSync(filePath, codexJsonl);
    return filePath;
  };

  it("sessionKey で分析し、v3（source付き）で保存する。プロンプトはソース名を含む", async () => {
    writeCodexLive();
    const prompts: string[] = [];
    const run = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return outcome;
    });

    const saved = await analyzeSession(`codex:${CODEX_UUID}`, { run });

    expect(saved?.schemaVersion).toBe(3);
    expect(saved?.sessionId).toBe(CODEX_UUID);
    expect(saved?.source).toBe("codex");
    expect(prompts[0]).toContain("Codex CLI のセッション");
    expect(prompts[0]).toContain("最初の質問");

    // sessionKey ファイル名で保存され、鮮度判定も sessionKey で解決できる
    expect(
      existsSync(path.join(baseDir, "analysis", `codex--${CODEX_UUID}.json`)),
    ).toBe(true);
    const status = await getAnalysisWithStaleness(`codex:${CODEX_UUID}`);
    expect(status?.analysis?.source).toBe("codex");
    expect(status?.isStale).toBe(false);
  });

  it("getAnalysisStatusMap は sessionKey をキーにする", async () => {
    writeCodexLive();
    const run = vi.fn(async () => outcome);
    await analyzeSession(`codex:${CODEX_UUID}`, { run });
    const map = await getAnalysisStatusMap();
    expect(map.get(`codex:${CODEX_UUID}`)).toBe("analyzed");
  });
});
