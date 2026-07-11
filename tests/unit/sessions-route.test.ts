import {
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
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSessions } from "@/app/api/sessions/route";
import type { RunOutcome } from "@/lib/analysis/runner";
import { analyzeSession } from "@/lib/analysis/service";
import { getGlobalCache } from "@/lib/store/cache";
import { mkAnalysisResult } from "./helpers";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

const outcome: RunOutcome = {
  result: mkAnalysisResult(),
  costUSD: 0.02,
};

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-sess-"));
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

const req = (url = "/api/sessions") =>
  new NextRequest(`http://127.0.0.1:3947${url}`);

const fetchStatuses = async (): Promise<Map<string, string>> => {
  const res = await getSessions(req());
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    sessions: { sessionId: string; analysisStatus: string }[];
  };
  return new Map(body.sessions.map((s) => [s.sessionId, s.analysisStatus]));
};

describe("GET /api/sessions の analysisStatus", () => {
  it("未分析は none", async () => {
    writeLive(UUID_A, basicJsonl);
    expect((await fetchStatuses()).get(UUID_A)).toBe("none");
  });

  it("分析済みは analyzed、セッション更新後は stale", async () => {
    const filePath = writeLive(UUID_A, basicJsonl);
    writeLive(UUID_B, basicJsonl);
    await analyzeSession(UUID_A, { run: async () => outcome });

    let statuses = await fetchStatuses();
    expect(statuses.get(UUID_A)).toBe("analyzed");
    expect(statuses.get(UUID_B)).toBe("none");

    writeFileSync(filePath, `${basicJsonl}\n`);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    getGlobalCache().clear();

    statuses = await fetchStatuses();
    expect(statuses.get(UUID_A)).toBe("stale");
  });

  it("分析実行中は analyzing", async () => {
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

    expect((await fetchStatuses()).get(UUID_A)).toBe("analyzing");

    release(outcome);
    await pending;
    expect((await fetchStatuses()).get(UUID_A)).toBe("analyzed");
  });
});
