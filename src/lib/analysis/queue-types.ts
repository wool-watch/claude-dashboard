import { UUID_RE } from "@/lib/analysis/store";

/** キュー項目の状態遷移: pending → running → done | failed（解除は「削除」であり状態ではない） */
export type QueueItemState = "pending" | "running" | "done" | "failed";

export interface QueueItem {
  sessionId: string; // UUID
  state: QueueItemState;
  enqueuedAt: string; // ISO8601
  startedAt?: string; // running 遷移時刻
  finishedAt?: string; // done / failed 遷移時刻
  error?: string; // failed のときのみ。UI にそのまま表示する日本語メッセージ
}

/** analysisDir/analysis-queue.json に保存する形式 */
export interface StoredQueue {
  schemaVersion: 1;
  /** true の間ワーカーは起動しない。起動時に未完了があると true になる。解除は再開操作のみ */
  paused: boolean;
  items: QueueItem[]; // enqueuedAt 昇順（= 投入順 = 実行順）
}

export const EMPTY_QUEUE: StoredQueue = {
  schemaVersion: 1,
  paused: false,
  items: [],
};

const QUEUE_ITEM_STATES: readonly string[] = [
  "pending",
  "running",
  "done",
  "failed",
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isQueueItem(v: unknown): v is QueueItem {
  if (!isObject(v)) return false;
  if (typeof v.sessionId !== "string" || !UUID_RE.test(v.sessionId)) return false;
  if (typeof v.state !== "string" || !QUEUE_ITEM_STATES.includes(v.state)) {
    return false;
  }
  if (typeof v.enqueuedAt !== "string") return false;
  if (v.startedAt !== undefined && typeof v.startedAt !== "string") return false;
  if (v.finishedAt !== undefined && typeof v.finishedAt !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

export function isStoredQueue(v: unknown): v is StoredQueue {
  if (!isObject(v)) return false;
  if (v.schemaVersion !== 1) return false;
  if (typeof v.paused !== "boolean") return false;
  return Array.isArray(v.items) && v.items.every(isQueueItem);
}
