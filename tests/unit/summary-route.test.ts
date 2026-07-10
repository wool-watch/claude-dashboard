import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getSummary } from "@/app/api/summary/route";
import type { ApiSummary } from "@/lib/types";
import { getGlobalCache } from "@/lib/store/cache";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-summary-"));
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
});

const writeLive = (projectId: string, uuid: string, content: string) => {
  const dir = path.join(baseDir, "live", projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${uuid}.jsonl`), content);
};

const req = (url: string) => new NextRequest(`http://127.0.0.1:3947${url}`);

const fetchSummary = async (url: string): Promise<ApiSummary> => {
  const res = await getSummary(req(url));
  expect(res.status).toBe(200);
  return (await res.json()) as ApiSummary;
};

describe("GET /api/summary の project フィルタ", () => {
  beforeEach(() => {
    writeLive("-proj-a", UUID_A, basicJsonl);
    writeLive("-proj-b", UUID_B, basicJsonl);
  });

  it("project 指定なしは全プロジェクトを集計する", async () => {
    const body = await fetchSummary("/api/summary");
    expect(body.totals.sessionCount).toBe(2);
  });

  it("?project= で該当プロジェクトのみ集計する", async () => {
    const body = await fetchSummary("/api/summary?project=-proj-a");
    expect(body.totals.sessionCount).toBe(1);
    expect(body.totals.turnCount).toBe(2); // fixture は2ターン
  });

  it("不存在プロジェクトはゼロ値", async () => {
    const body = await fetchSummary("/api/summary?project=-proj-zzz");
    expect(body.totals.sessionCount).toBe(0);
    expect(body.totals.costUSD).toBe(0);
  });
});
