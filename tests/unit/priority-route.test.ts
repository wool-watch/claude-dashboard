import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPriority, POST as postPriority } from "@/app/api/analysis/priority/route";
import { writeAnalysis } from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";

const UUID_A = "11111111-1111-1111-1111-111111111111";

const priorityResult = {
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

let baseDir: string;
let analysisDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-prio-route-"));
  analysisDir = path.join(baseDir, "analysis");
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
  process.env.CLAUDE_SETTINGS_PATH = path.join(baseDir, "settings.json");
});

afterEach(() => {
  delete process.env.CLAUDE_ANALYSIS_DIR;
  delete process.env.CLAUDE_CLI_PATH;
  delete process.env.CLAUDE_SETTINGS_PATH;
  vi.unstubAllGlobals();
  rmSync(baseDir, { recursive: true, force: true });
});

const storedAnalysis = (): StoredAnalysis => ({
  schemaVersion: 1,
  sessionId: UUID_A,
  projectId: "-proj-a",
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-07-01T00:01:10.000Z",
  costUSD: 0.01,
  result: {
    summary: "要約。",
    goodPoints: ["良い点"],
    improvements: [{ point: "改善点", category: "タスク分割" }],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

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
      result: priorityResult,
      is_error: false,
      total_cost_usd: 0.05,
    })}\nENVELOPE`,
  );

const postReq = (body: unknown) =>
  new Request("http://127.0.0.1:3947/api/analysis/priority", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

describe("POST /api/analysis/priority", () => {
  it("正常実行で 200・priority-analysis.json 生成・結果返却", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    okCli();

    const res = await postPriority(postReq({ model: "opus" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority.model).toBe("opus");
    expect(body.priority.result.summary).toBe("全体講評。");
    expect(existsSync(path.join(analysisDir, "priority-analysis.json"))).toBe(true);
  });

  it("不正なモデルは 400", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    const res = await postPriority(postReq({ model: "gpt" }));
    expect(res.status).toBe(400);
  });

  it("保存済み分析が0件なら 400", async () => {
    okCli();
    const res = await postPriority(postReq({ model: "haiku" }));
    expect(res.status).toBe(400);
  });

  it("CLI が is_error を返したら 502", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    setFakeCli(
      `cat <<'ENVELOPE'\n${JSON.stringify({
        type: "result",
        result: "budget exceeded",
        is_error: true,
      })}\nENVELOPE`,
    );
    const res = await postPriority(postReq({ model: "haiku" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("budget exceeded");
  });
});

describe("POST /api/analysis/priority: プロバイダ対応", () => {
  it("model 省略時は設定のモデルで実行する", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    writeFileSync(
      path.join(baseDir, "settings.json"),
      JSON.stringify({ providers: { claude: { model: "sonnet" } } }),
    );
    okCli();

    const res = await postPriority(postReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority.model).toBe("sonnet");
    expect(body.priority.provider).toBe("claude");
  });

  it("lmstudio プロバイダなら fetch 経由で実行し model 指定は無視する", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
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
            choices: [{ message: { content: JSON.stringify(priorityResult) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const res = await postPriority(postReq({ model: "opus" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority.provider).toBe("lmstudio");
    expect(body.priority.model).toBe("qwen3");
  });

  it("接続失敗は 502 で接続エラーメッセージを返す", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
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
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const res = await postPriority(postReq({}));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("接続できません");
  });
});

describe("GET /api/analysis/priority", () => {
  it("未保存は priority null / isAnalyzing false", async () => {
    const res = await getPriority();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ priority: null, isAnalyzing: false });
  });

  it("実行後は保存済みの結果を返す", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    okCli();
    await postPriority(postReq({ model: "sonnet" }));

    const res = await getPriority();
    const body = await res.json();
    expect(body.priority.model).toBe("sonnet");
    expect(body.priority.analyzedSessionCount).toBe(1);
    expect(body.isAnalyzing).toBe(false);
  });
});

const getReq = (url: string) => new NextRequest(`http://127.0.0.1:3947${url}`);

describe("プロジェクト別の優先課題分析", () => {
  it("POST { model, project } でプロジェクト別に保存し projectId を返す", async () => {
    await writeAnalysis(analysisDir, storedAnalysis()); // projectId "-proj-a"
    okCli();

    const res = await postPriority(postReq({ model: "haiku", project: "-proj-a" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority.projectId).toBe("-proj-a");
    expect(
      existsSync(path.join(analysisDir, "priority-analysis.-proj-a.json")),
    ).toBe(true);
    expect(existsSync(path.join(analysisDir, "priority-analysis.json"))).toBe(false);
  });

  it("不正な project は 400", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    okCli();
    expect(
      (await postPriority(postReq({ model: "haiku", project: "../etc" }))).status,
    ).toBe(400);
    expect(
      (await postPriority(postReq({ model: "haiku", project: 123 }))).status,
    ).toBe(400);
    expect(
      (await postPriority(postReq({ model: "haiku", project: "" }))).status,
    ).toBe(400);
  });

  it("GET ?project= はプロジェクト別の結果を返し、グローバルとは独立", async () => {
    await writeAnalysis(analysisDir, storedAnalysis());
    okCli();
    await postPriority(postReq({ model: "sonnet", project: "-proj-a" }));

    const res = await getPriority(getReq("/api/analysis/priority?project=-proj-a"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority.projectId).toBe("-proj-a");
    expect(body.isAnalyzing).toBe(false);

    const globalRes = await getPriority();
    expect((await globalRes.json()).priority).toBeNull();
  });

  it("GET の不正な project は 400", async () => {
    const res = await getPriority(getReq("/api/analysis/priority?project=a/b"));
    expect(res.status).toBe(400);
  });
});
