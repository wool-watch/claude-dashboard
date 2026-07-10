import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueSessions,
  getQueueSnapshot,
  normalizeQueueOnBoot,
  releaseSession,
  resumeQueue,
} from "@/lib/analysis/queue";
import type { QueueItem } from "@/lib/analysis/queue-types";
import { AnalysisError, type RunOutcome } from "@/lib/analysis/runner";
import { analyzeSession } from "@/lib/analysis/service";
import { writeQueue } from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";
import { getGlobalCache } from "@/lib/store/cache";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

let baseDir: string;
let analysisDir: string;

/** enqueue / resume が起動したワーカーの完走を待つ */
const awaitWorker = () =>
  globalThis.__claudeDashboardQueueWorker ?? Promise.resolve();

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-queue-"));
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
  vi.restoreAllMocks();
});

const writeLive = (uuid: string, content: string) => {
  const dir = path.join(baseDir, "live", "-proj-a");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${uuid}.jsonl`);
  writeFileSync(filePath, content);
  return filePath;
};

const at = (sec: number) =>
  new Date(Date.UTC(2026, 6, 10, 0, 0, sec)).toISOString();

const pendingItem = (sessionId: string, sec = 0): QueueItem => ({
  sessionId,
  state: "pending",
  enqueuedAt: at(sec),
});

const mkStored = (sessionId: string): StoredAnalysis => ({
  schemaVersion: 1,
  sessionId,
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
    improvements: [{ point: "改善点", category: "その他" }],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

const outcome: RunOutcome = {
  result: mkStored(UUID_A).result,
  costUSD: 0.02,
};

describe("enqueueSessions とワーカー", () => {
  it("新規追加して投入順に直列実行し done にする", async () => {
    const order: string[] = [];
    let active = 0;
    const analyze = vi.fn(async (sessionId: string) => {
      active += 1;
      expect(active).toBe(1); // 並列実行しない
      order.push(sessionId);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return mkStored(sessionId);
    });

    const result = await enqueueSessions([UUID_A, UUID_B], { analyze });
    expect(result).toEqual({
      queued: [UUID_A, UUID_B],
      skipped: [],
      paused: false,
    });

    await awaitWorker();
    expect(order).toEqual([UUID_A, UUID_B]);
    const q = await getQueueSnapshot();
    expect(q.items.map((i) => i.state)).toEqual(["done", "done"]);
    expect(q.items.every((i) => i.finishedAt !== undefined)).toBe(true);
  });

  it("null は failed、AnalysisError も failed で後続は続行する", async () => {
    const analyze = vi.fn(async (sessionId: string) => {
      if (sessionId === UUID_A) return null;
      if (sessionId === UUID_B) {
        throw new AnalysisError("CLI がエラー終了しました", "cli-failed");
      }
      return mkStored(sessionId);
    });

    await enqueueSessions([UUID_A, UUID_B, UUID_C], { analyze });
    await awaitWorker();

    const items = (await getQueueSnapshot()).items;
    expect(items.map((i) => i.state)).toEqual(["failed", "failed", "done"]);
    expect(items[0].error).toContain("見つかりません");
    expect(items[1].error).toBe("CLI がエラー終了しました");
  });

  it("pending 済みはスキップし、保留中はワーカーを起動せず paused を返す", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: [pendingItem(UUID_A)],
    });
    const analyze = vi.fn(async (sessionId: string) => mkStored(sessionId));

    const result = await enqueueSessions([UUID_A, UUID_B], { analyze });
    expect(result).toEqual({ queued: [UUID_B], skipped: [UUID_A], paused: true });
    expect(analyze).not.toHaveBeenCalled();

    const q = await getQueueSnapshot();
    expect(q.paused).toBe(true);
    expect(q.items.map((i) => i.sessionId)).toEqual([UUID_A, UUID_B]);
    expect(q.items.map((i) => i.state)).toEqual(["pending", "pending"]);
  });

  it("個別分析の実行中(in-flight)はスキップする", async () => {
    writeLive(UUID_A, basicJsonl);
    let release: (v: RunOutcome) => void = () => {};
    const gate = new Promise<RunOutcome>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => gate);
    const pending = analyzeSession(UUID_A, { run });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    const analyze = vi.fn(async (sessionId: string) => mkStored(sessionId));
    const result = await enqueueSessions([UUID_A], { analyze });
    expect(result.queued).toEqual([]);
    expect(result.skipped).toEqual([UUID_A]);
    expect(analyze).not.toHaveBeenCalled();

    release(outcome);
    await pending;
  });

  it("非UUIDと重複は除去する", async () => {
    await writeQueue(analysisDir, { schemaVersion: 1, paused: true, items: [] });
    const result = await enqueueSessions(["not-a-uuid", UUID_A, UUID_A], {
      analyze: vi.fn(async (sessionId: string) => mkStored(sessionId)),
    });
    expect(result.queued).toEqual([UUID_A]);
    expect((await getQueueSnapshot()).items).toHaveLength(1);
  });

  it("done/failed の履歴をプルーニングする（50件上限・同一IDの旧履歴削除）", async () => {
    const history: QueueItem[] = [];
    for (let i = 0; i < 51; i += 1) {
      history.push({
        sessionId: randomUUID(),
        state: "done",
        enqueuedAt: at(i),
        finishedAt: at(i),
      });
    }
    history.push({
      sessionId: UUID_A,
      state: "failed",
      enqueuedAt: at(51),
      finishedAt: at(51),
      error: "x",
    });
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: history,
    });

    await enqueueSessions([UUID_A], {
      analyze: vi.fn(async (sessionId: string) => mkStored(sessionId)),
    });

    const items = (await getQueueSnapshot()).items;
    // UUID_A の旧 failed は削除され、新規 pending が1件だけ残る
    const itemsA = items.filter((i) => i.sessionId === UUID_A);
    expect(itemsA).toHaveLength(1);
    expect(itemsA[0].state).toBe("pending");
    // done/failed は 50 件に収まり、最古のものから削除される
    const kept = items.filter((i) => i.state === "done" || i.state === "failed");
    expect(kept).toHaveLength(50);
    expect(kept.some((i) => i.enqueuedAt === at(0))).toBe(false);
  });
});

describe("normalizeQueueOnBoot", () => {
  it("running を pending に戻し、未完了があれば paused にする（ワーカーは起動しない）", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: false,
      items: [
        { sessionId: UUID_A, state: "running", enqueuedAt: at(0), startedAt: at(1) },
        pendingItem(UUID_B, 2),
      ],
    });

    await normalizeQueueOnBoot();

    const q = await getQueueSnapshot();
    expect(q.paused).toBe(true);
    expect(q.items.map((i) => i.state)).toEqual(["pending", "pending"]);
    expect(q.items[0].startedAt).toBeUndefined();

    // ワーカーが起動していない（時間を置いても pending のまま）
    await new Promise((r) => setTimeout(r, 50));
    expect((await getQueueSnapshot()).items.map((i) => i.state)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("未完了が無ければ paused は変更しない", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: false,
      items: [
        { sessionId: UUID_A, state: "done", enqueuedAt: at(0), finishedAt: at(1) },
      ],
    });
    await normalizeQueueOnBoot();
    expect((await getQueueSnapshot()).paused).toBe(false);
  });

  it("空キューはそのまま", async () => {
    await normalizeQueueOnBoot();
    expect(await getQueueSnapshot()).toEqual({
      schemaVersion: 1,
      paused: false,
      items: [],
    });
  });
});

describe("resumeQueue", () => {
  it("保留を解除し pending をワーカーで実行する", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: [pendingItem(UUID_A)],
    });
    const analyze = vi.fn(async (sessionId: string) => mkStored(sessionId));

    await resumeQueue({ analyze });
    await awaitWorker();

    const q = await getQueueSnapshot();
    expect(q.paused).toBe(false);
    expect(q.items[0].state).toBe("done");
    expect(analyze).toHaveBeenCalledOnce();
  });

  it("pending が無ければ paused の解除のみ行う", async () => {
    await writeQueue(analysisDir, { schemaVersion: 1, paused: true, items: [] });
    const analyze = vi.fn(async (sessionId: string) => mkStored(sessionId));

    await resumeQueue({ analyze });

    expect((await getQueueSnapshot()).paused).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
  });
});

describe("releaseSession", () => {
  it("pending を削除して true（paused は維持する）", async () => {
    await writeQueue(analysisDir, {
      schemaVersion: 1,
      paused: true,
      items: [pendingItem(UUID_A), pendingItem(UUID_B, 1)],
    });

    expect(await releaseSession(UUID_A)).toBe(true);

    const q = await getQueueSnapshot();
    expect(q.items.map((i) => i.sessionId)).toEqual([UUID_B]);
    expect(q.paused).toBe(true);
  });

  it("不存在は false", async () => {
    expect(await releaseSession(UUID_A)).toBe(false);
  });

  it("running は中止(abort)して削除し、結果は破棄して後続へ進む", async () => {
    let sawAbort = false;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const analyze = vi.fn(
      async (
        sessionId: string,
        _deps: undefined,
        opts: { signal: AbortSignal },
      ) => {
        if (sessionId === UUID_A) {
          opts.signal.addEventListener("abort", () => {
            sawAbort = true;
            releaseGate();
          });
          await gate;
        }
        return mkStored(sessionId);
      },
    );

    await enqueueSessions([UUID_A, UUID_B], { analyze });
    await vi.waitFor(async () => {
      expect((await getQueueSnapshot()).items[0]?.state).toBe("running");
    });

    expect(await releaseSession(UUID_A)).toBe(true);
    expect(sawAbort).toBe(true);

    await awaitWorker();
    const q = await getQueueSnapshot();
    // 解除された UUID_A は履歴にも残らず、UUID_B は完走する
    expect(q.items.map((i) => [i.sessionId, i.state])).toEqual([
      [UUID_B, "done"],
    ]);
  });
});
