import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteQueueItem } from "@/app/api/analysis/queue/[sessionId]/route";
import { POST as postResume } from "@/app/api/analysis/queue/resume/route";
import { GET as getQueue, POST as postQueue } from "@/app/api/analysis/queue/route";
import { getQueueSnapshot } from "@/lib/analysis/queue";
import type { QueueItem } from "@/lib/analysis/queue-types";
import { writeQueue } from "@/lib/analysis/store";
import { getGlobalCache } from "@/lib/store/cache";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

let baseDir: string;
let analysisDir: string;

const awaitWorker = () =>
  globalThis.__claudeDashboardQueueWorker ?? Promise.resolve();

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-queue-route-"));
  analysisDir = path.join(baseDir, "analysis");
  process.env.CLAUDE_DATA_DIR = path.join(baseDir, "live");
  process.env.CLAUDE_ARCHIVE_DIR = path.join(baseDir, "archive");
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
  process.env.CLAUDE_SETTINGS_PATH = path.join(baseDir, "settings.json");
  getGlobalCache().clear();
});

afterEach(async () => {
  await awaitWorker();
  delete process.env.CLAUDE_DATA_DIR;
  delete process.env.CLAUDE_ARCHIVE_DIR;
  delete process.env.CLAUDE_ANALYSIS_DIR;
  delete process.env.CLAUDE_SETTINGS_PATH;
  rmSync(baseDir, { recursive: true, force: true });
});

const writeLive = (uuid: string, content: string) => {
  const dir = path.join(baseDir, "live", "-proj-a");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${uuid}.jsonl`), content);
};

const postReq = (body: unknown) =>
  new Request("http://127.0.0.1:3947/api/analysis/queue", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const req = (url: string, method = "GET") =>
  new Request(`http://127.0.0.1:3947${url}`, { method }) as unknown as NextRequest;

const ctx = (sessionId: string) => ({
  params: Promise.resolve({ sessionId }),
});

const pendingItem = (sessionId: string, enqueuedAt: string): QueueItem => ({
  sessionId,
  state: "pending",
  enqueuedAt,
});

describe("POST /api/analysis/queue", () => {
  it("202 で queued / skipped / paused を返し、存在しないセッションは failed で完走する", async () => {
    const res = await postQueue(postReq({ sessionIds: [UUID_A, UUID_B] }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      queued: [UUID_A, UUID_B],
      skipped: [],
      paused: false,
    });

    await vi.waitFor(async () => {
      const q = await getQueueSnapshot();
      expect(q.items.map((i) => i.state)).toEqual(["failed", "failed"]);
    });
  });

  it("空配列・非配列・欠損・UUID以外混入・500件超は 400", async () => {
    expect((await postQueue(postReq({ sessionIds: [] }))).status).toBe(400);
    expect((await postQueue(postReq({ sessionIds: "x" }))).status).toBe(400);
    expect((await postQueue(postReq({}))).status).toBe(400);
    expect(
      (await postQueue(postReq({ sessionIds: [UUID_A, "not-a-uuid"] }))).status,
    ).toBe(400);
    const many = Array.from({ length: 501 }, () => UUID_A);
    expect((await postQueue(postReq({ sessionIds: many }))).status).toBe(400);
  });
});

describe("GET /api/analysis/queue", () => {
  it("items にセッション情報を join し counts を返す（消滅セッションは null）", async () => {
    writeLive(UUID_A, basicJsonl);
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: [
        pendingItem(UUID_A, "2026-07-10T00:00:00.000Z"),
        pendingItem(UUID_B, "2026-07-10T00:00:01.000Z"),
      ],
    });

    const res = await getQueue();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(true);
    expect(body.counts).toEqual({ pending: 2, running: 0, failed: 0 });
    expect(body.items[0]).toMatchObject({
      sessionId: UUID_A,
      state: "pending",
      title: "テストセッション",
      projectId: "-proj-a",
    });
    expect(body.items[1]).toMatchObject({
      sessionId: UUID_B,
      title: null,
      projectId: null,
    });
  });
});

describe("POST /api/analysis/queue/resume", () => {
  it("paused を解除して 200", async () => {
    await writeQueue(analysisDir, { schemaVersion: 1, paused: true, items: [] });

    const res = await postResume();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paused: false });
    expect((await getQueueSnapshot()).paused).toBe(false);
  });
});

describe("DELETE /api/analysis/queue/[sessionId]", () => {
  it("キュー項目を解除して 200", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: [pendingItem(UUID_A, "2026-07-10T00:00:00.000Z")],
    });

    const res = await deleteQueueItem(
      req(`/api/analysis/queue/${UUID_A}`, "DELETE"),
      ctx(UUID_A),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: true });
    expect((await getQueueSnapshot()).items).toEqual([]);
  });

  it("不存在は 404", async () => {
    const res = await deleteQueueItem(
      req(`/api/analysis/queue/${UUID_A}`, "DELETE"),
      ctx(UUID_A),
    );
    expect(res.status).toBe(404);
  });
});
