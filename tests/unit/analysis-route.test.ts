import {
  chmodSync,
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
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSummary } from "@/app/api/analysis/summary/route";
import { GET as getAnalysis } from "@/app/api/sessions/[id]/analysis/route";
import { POST as postAnalyze } from "@/app/api/sessions/[id]/analyze/route";
import type { RunOutcome } from "@/lib/analysis/runner";
import { analyzeSession } from "@/lib/analysis/service";
import { writeQueue } from "@/lib/analysis/store";
import { getGlobalCache } from "@/lib/store/cache";
import { mkLegacyStoredJson } from "./helpers";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

const validResult = {
  summary: "テストの要約。",
  goodPoints: ["良い点1"],
  improvements: [{ action: "改善アクション1", category: "計画不足" }],
  scores: {
    planning: 4,
    contextProvision: 3,
    verification: 5,
    trajectoryStability: 4,
    scopeDiscipline: 3,
  },
};

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-route-"));
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
  delete process.env.CLAUDE_CLI_PATH;
  rmSync(baseDir, { recursive: true, force: true });
});

const writeLive = (uuid: string, content: string) => {
  const dir = path.join(baseDir, "live", "-proj-a");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${uuid}.jsonl`);
  writeFileSync(filePath, content);
  return filePath;
};

const setFakeCli = (body: string) => {
  const cliPath = path.join(baseDir, "fake-claude.sh");
  writeFileSync(cliPath, `#!/bin/sh\ncat > /dev/null\n${body}\n`);
  chmodSync(cliPath, 0o755);
  process.env.CLAUDE_CLI_PATH = cliPath;
};

const okCli = () =>
  setFakeCli(
    `cat <<'ENVELOPE'\n${JSON.stringify({
      type: "result",
      result: validResult,
      is_error: false,
      total_cost_usd: 0.01,
    })}\nENVELOPE`,
  );

const req = (url: string, method = "GET") =>
  new Request(`http://127.0.0.1:3947${url}`, { method }) as unknown as NextRequest;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/sessions/[id]/analyze", () => {
  it("未知セッションは 404", async () => {
    okCli();
    const res = await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    expect(res.status).toBe(404);
  });

  it("不正UUIDは 404", async () => {
    okCli();
    const res = await postAnalyze(
      req("/api/sessions/not-a-uuid/analyze", "POST"),
      ctx("not-a-uuid"),
    );
    expect(res.status).toBe(404);
  });

  it("正常実行で 200・分析ファイル生成・結果返却", async () => {
    writeLive(UUID_A, basicJsonl);
    okCli();

    const res = await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.result.summary).toBe("テストの要約。");
    expect(body.isStale).toBe(false);
    expect(existsSync(path.join(baseDir, "analysis", `${UUID_A}.json`))).toBe(true);
  });

  it("設定プロバイダが lmstudio なら fetch 経由で分析し provider を保存する", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validResult) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const res = await postAnalyze(
      req(`/api/sessions/${UUID_A}/analyze`, "POST"),
      ctx(UUID_A),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.provider).toBe("lmstudio");
    expect(body.analysis.model).toBe("qwen3");
    vi.unstubAllGlobals();
  });

  it("CLI が is_error を返したら 502 でメッセージ露出", async () => {
    writeLive(UUID_A, basicJsonl);
    setFakeCli(
      `cat <<'ENVELOPE'\n${JSON.stringify({
        type: "result",
        result: "budget exceeded",
        is_error: true,
      })}\nENVELOPE`,
    );
    const res = await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("budget exceeded");
  });

  it("CLI 未インストールは 502 で明示メッセージ", async () => {
    writeLive(UUID_A, basicJsonl);
    process.env.CLAUDE_CLI_PATH = path.join(baseDir, "no-such-cli");
    const res = await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("見つかりません");
  });

  it("本線ユーザー発話ゼロは 400", async () => {
    writeLive(
      UUID_B,
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: "サブ" },
        timestamp: "2026-07-01T00:00:00.000Z",
        isSidechain: true,
      })}\n`,
    );
    okCli();
    const res = await postAnalyze(req(`/api/sessions/${UUID_B}/analyze`, "POST"), ctx(UUID_B));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/[id]/analysis", () => {
  it("セッションも分析も無ければ 404", async () => {
    const res = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect(res.status).toBe(404);
  });

  it("未分析セッションは analysis null", async () => {
    writeLive(UUID_A, basicJsonl);
    const res = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      analysis: null,
      isStale: false,
      isAnalyzing: false,
      isQueued: false,
    });
  });

  it("旧 v1 形式の分析は analysis null / isStale true（要再分析）", async () => {
    writeLive(UUID_A, basicJsonl);
    const analysisDir = path.join(baseDir, "analysis");
    mkdirSync(analysisDir, { recursive: true });
    writeFileSync(
      path.join(analysisDir, `${UUID_A}.json`),
      JSON.stringify(mkLegacyStoredJson(UUID_A)),
    );

    const res = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBeNull();
    expect(body.isStale).toBe(true);
  });

  it("分析実行中は isAnalyzing true、完了後は false", async () => {
    writeLive(UUID_A, basicJsonl);
    let release: (v: RunOutcome) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<RunOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const pending = analyzeSession(UUID_A, { run });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    const during = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect((await during.json()).isAnalyzing).toBe(true);

    release({
      result: validResult,
      costUSD: 0.01,
    } as RunOutcome);
    await pending;

    const after = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    const afterBody = await after.json();
    expect(afterBody.isAnalyzing).toBe(false);
    expect(afterBody.analysis.sessionId).toBe(UUID_A);
  });

  it("分析済みは保存値、追記後は isStale true", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    okCli();
    await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));

    const fresh = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    const freshBody = await fresh.json();
    expect(freshBody.analysis.sessionId).toBe(UUID_A);
    expect(freshBody.isStale).toBe(false);

    writeFileSync(filePath, `${basicJsonl}\n`);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);

    const stale = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect((await stale.json()).isStale).toBe(true);
  });
});

describe("GET /api/analysis/summary", () => {
  it("0件は analyzedCount 0", async () => {
    const res = await getSummary();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analyzedCount).toBe(0);
    expect(body.avgScores).toBeNull();
  });

  it("分析済み2件を集計する", async () => {
    writeLive(UUID_A, basicJsonl);
    writeLive(UUID_B, basicJsonl);
    okCli();
    await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    await postAnalyze(req(`/api/sessions/${UUID_B}/analyze`, "POST"), ctx(UUID_B));

    const res = await getSummary();
    const body = await res.json();
    expect(body.analyzedCount).toBe(2);
    expect(body.categoryRanking[0].category).toBe("計画不足");
    expect(body.avgScores.verification).toBe(5);
  });
});

describe("キュー待機中のセッション", () => {
  const seedQueuePending = (sessionId: string) =>
    writeQueue(path.join(baseDir, "analysis"), {
      schemaVersion: 1,
      paused: true,
      items: [
        { sessionId, state: "pending", enqueuedAt: "2026-07-10T00:00:00.000Z" },
      ],
    });

  it("GET analysis は isQueued true を返す", async () => {
    writeLive(UUID_A, basicJsonl);
    await seedQueuePending(UUID_A);

    const res = await getAnalysis(req(`/api/sessions/${UUID_A}/analysis`), ctx(UUID_A));
    expect(res.status).toBe(200);
    expect((await res.json()).isQueued).toBe(true);
  });

  it("POST analyze は 409 で拒否する", async () => {
    writeLive(UUID_A, basicJsonl);
    okCli();
    await seedQueuePending(UUID_A);

    const res = await postAnalyze(req(`/api/sessions/${UUID_A}/analyze`, "POST"), ctx(UUID_A));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("待機中");
  });
});
