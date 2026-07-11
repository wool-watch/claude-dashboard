import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/settings/route";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-settings-api-"));
  process.env.CLAUDE_SETTINGS_PATH = path.join(tmpDir, "settings.json");
});

afterEach(() => {
  delete process.env.CLAUDE_SETTINGS_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

const putRequest = (body: string) =>
  new Request("http://127.0.0.1:3000/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });

/** GET/PUT が返す公開形（apiKey は hasApiKey に変換される） */
const PUBLIC_DEFAULT = {
  retentionDays: null,
  analysisProvider: "claude",
  providers: {
    claude: { model: "haiku", cliPath: "" },
    codex: { model: "gpt-5-codex", cliPath: "codex" },
    gemini: { model: "gemini-2.5-flash", cliPath: "gemini" },
    lmstudio: { model: "", baseUrl: "http://localhost:1234/v1" },
    openaiCompatible: {
      model: "",
      baseUrl: "http://localhost:11434/v1",
      hasApiKey: false,
    },
  },
};

describe("GET /api/settings", () => {
  it("未設定ならデフォルト（無制限・claude）を公開形で返す", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PUBLIC_DEFAULT);
  });
});

describe("PUT /api/settings: retentionDays", () => {
  it("保持期間を保存し、保存値を返す", async () => {
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: 90 })));
    expect(res.status).toBe(200);
    expect((await res.json()).retentionDays).toBe(90);

    const after = await GET();
    expect((await after.json()).retentionDays).toBe(90);
  });

  it("無制限（null）へ戻せる", async () => {
    await PUT(putRequest(JSON.stringify({ retentionDays: 30 })));
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: null })));
    expect(res.status).toBe(200);
    expect((await res.json()).retentionDays).toBeNull();
  });

  it("不正な保持期間は 400", async () => {
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: 60 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("retentionDays");
  });
});

describe("PUT /api/settings: analysisProvider", () => {
  it("プロバイダを切り替えて保存できる", async () => {
    const res = await PUT(
      putRequest(JSON.stringify({ analysisProvider: "lmstudio" })),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).analysisProvider).toBe("lmstudio");
    expect((await (await GET()).json()).analysisProvider).toBe("lmstudio");
  });

  it("不正なプロバイダは 400", async () => {
    const res = await PUT(
      putRequest(JSON.stringify({ analysisProvider: "chatgpt" })),
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/settings: providers の部分更新", () => {
  it("1プロバイダのみ送ると該当プロバイダだけマージされる", async () => {
    const res = await PUT(
      putRequest(
        JSON.stringify({
          providers: {
            lmstudio: { baseUrl: "http://192.168.1.10:1234/v1", model: "qwen3" },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.lmstudio).toEqual({
      baseUrl: "http://192.168.1.10:1234/v1",
      model: "qwen3",
    });
    expect(body.providers.claude).toEqual(PUBLIC_DEFAULT.providers.claude);
  });

  it("プロバイダを切り替えても他プロバイダの設定は保持される", async () => {
    await PUT(
      putRequest(
        JSON.stringify({ providers: { lmstudio: { model: "qwen3" } } }),
      ),
    );
    await PUT(
      putRequest(JSON.stringify({ providers: { claude: { model: "sonnet" } } })),
    );
    const body = await (await GET()).json();
    expect(body.providers.lmstudio.model).toBe("qwen3");
    expect(body.providers.claude.model).toBe("sonnet");
  });

  it("フィールド単位の部分更新ができる（cliPath のみ）", async () => {
    const res = await PUT(
      putRequest(
        JSON.stringify({ providers: { codex: { cliPath: "/opt/bin/codex" } } }),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.codex).toEqual({
      model: "gpt-5-codex",
      cliPath: "/opt/bin/codex",
    });
  });

  it("claude の model は haiku/sonnet 以外 400", async () => {
    const res = await PUT(
      putRequest(JSON.stringify({ providers: { claude: { model: "opus" } } })),
    );
    expect(res.status).toBe(400);
  });

  it("不正な baseUrl（http(s) 以外）は 400", async () => {
    const res = await PUT(
      putRequest(
        JSON.stringify({ providers: { lmstudio: { baseUrl: "ftp://x" } } }),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("未知のプロバイダキーは 400", async () => {
    const res = await PUT(
      putRequest(JSON.stringify({ providers: { mystery: { model: "x" } } })),
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/settings: apiKey の扱い", () => {
  const putApiKey = (apiKey: unknown) =>
    PUT(
      putRequest(
        JSON.stringify({ providers: { openaiCompatible: { apiKey } } }),
      ),
    );

  it("apiKey を設定すると hasApiKey: true になり、キー本体は返さない", async () => {
    const res = await putApiKey("sk-test-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.openaiCompatible.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-test-secret");

    const getBody = await (await GET()).json();
    expect(getBody.providers.openaiCompatible.hasApiKey).toBe(true);
    expect(JSON.stringify(getBody)).not.toContain("sk-test-secret");
  });

  it("空文字の apiKey は変更なし（設定済みキーを保持）", async () => {
    await putApiKey("sk-test-secret");
    const res = await putApiKey("");
    expect((await res.json()).providers.openaiCompatible.hasApiKey).toBe(true);
  });

  it("null の apiKey はクリア", async () => {
    await putApiKey("sk-test-secret");
    const res = await putApiKey(null);
    expect((await res.json()).providers.openaiCompatible.hasApiKey).toBe(false);
  });
});

describe("PUT /api/settings: 不正ボディ", () => {
  it("旧 analysisModel キーはもう受け付けない（単独では 400）", async () => {
    const res = await PUT(putRequest(JSON.stringify({ analysisModel: "sonnet" })));
    expect(res.status).toBe(400);
  });

  it("有効キーの無いボディは 400", async () => {
    const res = await PUT(putRequest(JSON.stringify({})));
    expect(res.status).toBe(400);
  });

  it("壊れた JSON ボディは 400", async () => {
    const res = await PUT(putRequest("{not json"));
    expect(res.status).toBe(400);
  });
});
