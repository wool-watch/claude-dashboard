import type { QueueItem, StoredQueue } from "@/lib/analysis/queue-types";
import { AnalysisError } from "@/lib/analysis/runner";
import { analyzeSession, isAnalysisInflight } from "@/lib/analysis/service";
import { readQueue, writeQueue } from "@/lib/analysis/store";
import { isValidSessionKey } from "@/lib/sources/keys";
import type { StoredAnalysis } from "@/lib/analysis/types";
import { getConfig } from "@/lib/config";

/** ワーカーが呼ぶ分析関数（analyzeSession と同形。テストで差し替える） */
type AnalyzeFn = (
  sessionId: string,
  deps: undefined,
  opts: { signal: AbortSignal },
) => Promise<StoredAnalysis | null>;

export interface QueueDeps {
  analyze: AnalyzeFn;
}

const DEFAULT_DEPS: QueueDeps = { analyze: analyzeSession };

/** done / failed 履歴の保持上限 */
const HISTORY_LIMIT = 50;

export interface EnqueueResult {
  queued: string[]; // 今回新規に pending 追加された sessionId
  skipped: string[]; // 既に pending / running / 個別分析 in-flight のためスキップ
  paused: boolean; // true なら「保留中のため自動では開始しない」（UI が案内を出す）
}

declare global {
  // Next.js dev の HMR でモジュールが再評価されても状態を持ち続ける
  var __claudeDashboardQueueLock: Promise<unknown> | undefined;
  var __claudeDashboardQueueWorker: Promise<void> | undefined;
  /** 実行中項目の中止用（無ければ実行中なし） */
  var __claudeDashboardQueueCurrent:
    | { sessionId: string; controller: AbortController }
    | undefined;
}

/**
 * queue.json の read-modify-write を単一 Promise チェーンで直列化する。
 * キューの読み書きは必ずこの中で行う（単一 Node プロセス前提）。
 */
async function withQueueLock<T>(
  fn: (queue: StoredQueue) => Promise<{ queue: StoredQueue; result: T }>,
): Promise<T> {
  const prev = globalThis.__claudeDashboardQueueLock ?? Promise.resolve();
  const next = prev.then(async () => {
    const analysisDir = getConfig().analysisDir;
    const { queue, result } = await fn(await readQueue(analysisDir));
    await writeQueue(analysisDir, queue);
    return result;
  });
  // 失敗してもチェーンを止めない
  globalThis.__claudeDashboardQueueLock = next.catch(() => undefined);
  return next;
}

/** done/failed が上限を超えたら古い順（= 配列の先頭側）に削除する */
function pruneHistory(items: QueueItem[]): QueueItem[] {
  const history = items.filter(
    (i) => i.state === "done" || i.state === "failed",
  );
  if (history.length <= HISTORY_LIMIT) return items;
  const drop = new Set(history.slice(0, history.length - HISTORY_LIMIT));
  return items.filter((i) => !drop.has(i));
}

/** 複数セッションを pending 追加。paused でなければワーカーを起動する */
export async function enqueueSessions(
  sessionIds: string[],
  deps: QueueDeps = DEFAULT_DEPS,
): Promise<EnqueueResult> {
  const unique = [...new Set(sessionIds.filter((id) => isValidSessionKey(id)))];
  const result = await withQueueLock<EnqueueResult>(async (queue) => {
    const queued: string[] = [];
    const skipped: string[] = [];
    let items = [...queue.items];
    const active = new Set(
      items
        .filter((i) => i.state === "pending" || i.state === "running")
        .map((i) => i.sessionId),
    );
    for (const sessionId of unique) {
      if (active.has(sessionId) || isAnalysisInflight(sessionId)) {
        skipped.push(sessionId);
        continue;
      }
      // 再投入: 同一セッションの古い done/failed 履歴は削除する
      items = items.filter(
        (i) =>
          i.sessionId !== sessionId ||
          (i.state !== "done" && i.state !== "failed"),
      );
      items.push({
        sessionId,
        state: "pending",
        enqueuedAt: new Date().toISOString(),
      });
      queued.push(sessionId);
    }
    return {
      queue: { ...queue, items: pruneHistory(items) },
      result: { queued, skipped, paused: queue.paused },
    };
  });
  if (result.queued.length > 0 && !result.paused) startWorker(deps);
  return result;
}

/** 現在のキュー内容（UI 表示用・読み取りのみ） */
export async function getQueueSnapshot(): Promise<StoredQueue> {
  return readQueue(getConfig().analysisDir);
}

/**
 * キューから解除する。
 * - pending / done / failed: 項目を削除して true
 * - running: 実行中 CLI を abort（SIGKILL）して項目を削除、true
 * - 不存在: false
 */
export async function releaseSession(sessionId: string): Promise<boolean> {
  return withQueueLock<boolean>(async (queue) => {
    const target = queue.items.find((i) => i.sessionId === sessionId);
    if (target === undefined) return { queue, result: false };
    if (target.state === "running") {
      const current = globalThis.__claudeDashboardQueueCurrent;
      if (current !== undefined && current.sessionId === sessionId) {
        current.controller.abort();
      }
    }
    return {
      queue: { ...queue, items: queue.items.filter((i) => i !== target) },
      result: true,
    };
  });
}

/** 保留を解除してワーカーを起動する（pending が無ければ paused だけ false に） */
export async function resumeQueue(deps: QueueDeps = DEFAULT_DEPS): Promise<void> {
  const hasPending = await withQueueLock<boolean>(async (queue) => ({
    queue: { ...queue, paused: false },
    result: queue.items.some((i) => i.state === "pending"),
  }));
  if (hasPending) startWorker(deps);
}

/**
 * サーバー起動時の正規化: running → pending に戻す。
 * 未完了が残っていれば paused = true（自動再開しない。再開はユーザー操作のみ）。
 */
export async function normalizeQueueOnBoot(): Promise<void> {
  await withQueueLock<void>(async (queue) => {
    const items = queue.items.map(
      (i): QueueItem =>
        i.state === "running"
          ? { sessionId: i.sessionId, state: "pending", enqueuedAt: i.enqueuedAt }
          : i,
    );
    const paused = items.some((i) => i.state === "pending") || queue.paused;
    return { queue: { schemaVersion: 1, paused, items }, result: undefined };
  });
}

/** ワーカーを起動する（多重起動ガード付き） */
function startWorker(deps: QueueDeps): void {
  if (globalThis.__claudeDashboardQueueWorker !== undefined) return;
  const worker = runWorker(deps)
    .catch((e) => {
      console.error("analysis queue worker failed:", e);
    })
    .finally(() => {
      // 新しいワーカーに差し替わっていたら触らない
      if (globalThis.__claudeDashboardQueueWorker === worker) {
        globalThis.__claudeDashboardQueueWorker = undefined;
      }
    });
  globalThis.__claudeDashboardQueueWorker = worker;
}

/** 先頭の pending から1件ずつ直列実行する。失敗しても次へ進む */
async function runWorker(deps: QueueDeps): Promise<void> {
  for (;;) {
    const next = await withQueueLock<string | null>(async (queue) => {
      const idx = queue.paused
        ? -1
        : queue.items.findIndex((i) => i.state === "pending");
      if (idx === -1) {
        // 退出の確定をロック内で行い、enqueue 直後の pending 取りこぼしを防ぐ
        globalThis.__claudeDashboardQueueWorker = undefined;
        return { queue, result: null };
      }
      const items = [...queue.items];
      items[idx] = {
        ...items[idx],
        state: "running",
        startedAt: new Date().toISOString(),
      };
      return { queue: { ...queue, items }, result: items[idx].sessionId };
    });
    if (next === null) return;

    const controller = new AbortController();
    globalThis.__claudeDashboardQueueCurrent = { sessionId: next, controller };
    let failure: string | null = null;
    try {
      const stored = await deps.analyze(next, undefined, {
        signal: controller.signal,
      });
      if (stored === null) failure = "セッションが見つかりません";
    } catch (e) {
      failure = e instanceof AnalysisError ? e.message : String(e);
    } finally {
      globalThis.__claudeDashboardQueueCurrent = undefined;
    }

    await withQueueLock<void>(async (queue) => {
      const idx = queue.items.findIndex(
        (i) => i.sessionId === next && i.state === "running",
      );
      // 解除済み（項目が消えている）なら結果は破棄する
      if (idx === -1) return { queue, result: undefined };
      const items = [...queue.items];
      const finishedAt = new Date().toISOString();
      items[idx] =
        failure === null
          ? { ...items[idx], state: "done", finishedAt }
          : { ...items[idx], state: "failed", finishedAt, error: failure };
      return { queue: { ...queue, items }, result: undefined };
    });
  }
}
