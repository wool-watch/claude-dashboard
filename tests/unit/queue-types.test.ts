import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUE,
  isQueueItem,
  isStoredQueue,
} from "@/lib/analysis/queue-types";

const UUID_A = "11111111-1111-1111-1111-111111111111";

const item = {
  sessionId: UUID_A,
  state: "pending",
  enqueuedAt: "2026-07-10T00:00:00.000Z",
};

const queue = { schemaVersion: 1, paused: false, items: [item] };

describe("isQueueItem", () => {
  it("pending の最小形は true", () => {
    expect(isQueueItem(item)).toBe(true);
  });

  it("running / done / failed の付随フィールド付きも true", () => {
    expect(
      isQueueItem({
        ...item,
        state: "running",
        startedAt: "2026-07-10T00:00:01.000Z",
      }),
    ).toBe(true);
    expect(
      isQueueItem({
        ...item,
        state: "done",
        startedAt: "2026-07-10T00:00:01.000Z",
        finishedAt: "2026-07-10T00:00:02.000Z",
      }),
    ).toBe(true);
    expect(
      isQueueItem({
        ...item,
        state: "failed",
        finishedAt: "2026-07-10T00:00:02.000Z",
        error: "セッションが見つかりません",
      }),
    ).toBe(true);
  });

  it("state 不正は false", () => {
    expect(isQueueItem({ ...item, state: "canceled" })).toBe(false);
  });

  it("sessionId 非UUIDは false", () => {
    expect(isQueueItem({ ...item, sessionId: "not-a-uuid" })).toBe(false);
  });

  it("enqueuedAt 欠損・非文字列は false", () => {
    const { enqueuedAt: _drop, ...rest } = item;
    expect(isQueueItem(rest)).toBe(false);
    expect(isQueueItem({ ...item, enqueuedAt: 123 })).toBe(false);
  });
});

describe("isStoredQueue", () => {
  it("正常な保存形式と EMPTY_QUEUE は true", () => {
    expect(isStoredQueue(queue)).toBe(true);
    expect(isStoredQueue(EMPTY_QUEUE)).toBe(true);
  });

  it("schemaVersion 不一致は false", () => {
    expect(isStoredQueue({ ...queue, schemaVersion: 99 })).toBe(false);
  });

  it("paused 非booleanは false", () => {
    expect(isStoredQueue({ ...queue, paused: "yes" })).toBe(false);
  });

  it("items 非配列・不正項目混入は false", () => {
    expect(isStoredQueue({ ...queue, items: {} })).toBe(false);
    expect(
      isStoredQueue({ ...queue, items: [{ ...item, state: "unknown" }] }),
    ).toBe(false);
  });
});
