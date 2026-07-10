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

describe("GET /api/settings", () => {
  it("未設定ならデフォルト（無制限）を返す", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retentionDays: null });
  });
});

describe("PUT /api/settings", () => {
  it("保持期間を保存し、保存値を返す", async () => {
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: 90 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retentionDays: 90 });

    const after = await GET();
    expect(await after.json()).toEqual({ retentionDays: 90 });
  });

  it("無制限（null）へ戻せる", async () => {
    await PUT(putRequest(JSON.stringify({ retentionDays: 30 })));
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: null })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retentionDays: null });
  });

  it("不正な保持期間は 400", async () => {
    const res = await PUT(putRequest(JSON.stringify({ retentionDays: 60 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("retentionDays");
  });

  it("壊れた JSON ボディは 400", async () => {
    const res = await PUT(putRequest("{not json"));
    expect(res.status).toBe(400);
  });
});
