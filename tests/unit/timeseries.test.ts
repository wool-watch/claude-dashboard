// TZ=Asia/Tokyo で実行される前提（package.json の test スクリプトで固定）
import { describe, expect, it } from "vitest";
import { bucketize } from "@/lib/aggregate/timeseries";
import { mkSession, mkTurn, usageOf } from "./helpers";

const jst = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi);

describe("bucketize: TZ跨ぎ（最重要）", () => {
  it("UTC 15:30 のターンは JST 翌日のバケットに入る（day）", () => {
    // 2026-07-05T15:30:00Z = JST 2026-07-06 00:30
    const s = mkSession("s1", [
      mkTurn("2026-07-05T15:30:00.000Z"),
      mkTurn("2026-07-05T10:00:00.000Z"), // JST 7/5 19:00
    ]);
    const buckets = bucketize([s], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 7),
    });
    expect(buckets.map((b) => b.bucketStart)).toEqual([
      "2026-07-05T00:00",
      "2026-07-06T00:00",
    ]);
    expect(buckets[0].turnCount).toBe(1);
    expect(buckets[1].turnCount).toBe(1);
  });

  it("hour: JST のローカル時刻で丸める", () => {
    // 2026-07-04T16:30:00Z = JST 7/5 01:30 → "01:00" バケット
    const s = mkSession("s1", [mkTurn("2026-07-04T16:30:00.000Z")]);
    const buckets = bucketize([s], "hour", {
      from: jst(2026, 7, 5, 0),
      to: jst(2026, 7, 5, 3),
    });
    expect(buckets.map((b) => b.bucketStart)).toEqual([
      "2026-07-05T00:00",
      "2026-07-05T01:00",
      "2026-07-05T02:00",
    ]);
    expect(buckets[1].turnCount).toBe(1);
  });
});

describe("bucketize: 週・月の境界", () => {
  it("週は月曜開始（日曜 7/5 と月曜 7/6 は別バケット）", () => {
    const s = mkSession("s1", [
      mkTurn("2026-07-05T03:00:00.000Z"), // JST 7/5(日) 12:00 → 6/29週
      mkTurn("2026-07-06T03:00:00.000Z"), // JST 7/6(月) 12:00 → 7/6週
    ]);
    const buckets = bucketize([s], "week", {
      from: jst(2026, 6, 29),
      to: jst(2026, 7, 13),
    });
    expect(buckets.map((b) => b.bucketStart)).toEqual([
      "2026-06-29T00:00",
      "2026-07-06T00:00",
    ]);
    expect(buckets[0].turnCount).toBe(1);
    expect(buckets[1].turnCount).toBe(1);
  });

  it("月バケット", () => {
    const s = mkSession("s1", [mkTurn("2026-06-15T00:00:00.000Z")]);
    const buckets = bucketize([s], "month", {
      from: jst(2026, 5, 1),
      to: jst(2026, 8, 1),
    });
    expect(buckets.map((b) => b.bucketStart)).toEqual([
      "2026-05-01T00:00",
      "2026-06-01T00:00",
      "2026-07-01T00:00",
    ]);
    expect(buckets[1].turnCount).toBe(1);
  });
});

describe("bucketize: 期間フィルタと0埋め", () => {
  it("空バケットは0埋めされる", () => {
    const s = mkSession("s1", [mkTurn("2026-07-06T03:00:00.000Z")]);
    const buckets = bucketize([s], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 8),
    });
    expect(buckets).toHaveLength(3);
    expect(buckets[0].turnCount).toBe(0);
    expect(buckets[0].costUSD).toBe(0);
    expect(buckets[0].sessionCount).toBe(0);
    expect(buckets[2].turnCount).toBe(0);
  });

  it("to は排他境界（to ちょうどのターンは入らない）", () => {
    const s = mkSession("s1", [mkTurn("2026-07-06T15:00:00.000Z")]); // JST 7/7 00:00
    const buckets = bucketize([s], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 7), // = JST 7/7 00:00
    });
    expect(buckets.reduce((a, b) => a + b.turnCount, 0)).toBe(0);
  });

  it("範囲外のターンは無視される", () => {
    const s = mkSession("s1", [mkTurn("2026-01-01T00:00:00.000Z")]);
    const buckets = bucketize([s], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 6),
    });
    expect(buckets.reduce((a, b) => a + b.turnCount, 0)).toBe(0);
  });

  it("project フィルタ", () => {
    const a = mkSession("s1", [mkTurn("2026-07-05T03:00:00.000Z")], {
      projectId: "-proj-a",
    });
    const b = mkSession("s2", [mkTurn("2026-07-05T04:00:00.000Z")], {
      projectId: "-proj-b",
    });
    const buckets = bucketize([a, b], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 6),
      projectId: "-proj-a",
    });
    expect(buckets[0].turnCount).toBe(1);
  });
});

describe("bucketize: デフォルト期間（now 注入）", () => {
  const now = jst(2026, 7, 9, 12, 0);

  it("day: 過去30日分のバケット", () => {
    const buckets = bucketize([], "day", {}, now);
    expect(buckets).toHaveLength(30);
    expect(buckets[buckets.length - 1].bucketStart).toBe("2026-07-09T00:00");
    expect(buckets[0].bucketStart).toBe("2026-06-10T00:00");
  });

  it("hour: 過去48時間分", () => {
    const buckets = bucketize([], "hour", {}, now);
    expect(buckets).toHaveLength(48);
    expect(buckets[buckets.length - 1].bucketStart).toBe("2026-07-09T12:00");
  });

  it("week: 過去26週分（月曜開始）", () => {
    const buckets = bucketize([], "week", {}, now);
    expect(buckets).toHaveLength(26);
    expect(buckets[buckets.length - 1].bucketStart).toBe("2026-07-06T00:00");
  });

  it("month: 過去12ヶ月分", () => {
    const buckets = bucketize([], "month", {}, now);
    expect(buckets).toHaveLength(12);
    expect(buckets[buckets.length - 1].bucketStart).toBe("2026-07-01T00:00");
    expect(buckets[0].bucketStart).toBe("2025-08-01T00:00");
  });
});

describe("bucketize: 集計値", () => {
  it("usage / cost / activeTime / messageCount / sessionCount を合算する", () => {
    const s1 = mkSession("s1", [
      mkTurn("2026-07-05T01:00:00.000Z", {
        usage: usageOf(100, 10),
        costUSD: 0.5,
        activeTimeMs: 30_000,
        assistantMessageCount: 3,
      }),
      mkTurn("2026-07-05T02:00:00.000Z", {
        usage: usageOf(200, 20),
        costUSD: 0.25,
        activeTimeMs: 10_000,
        assistantMessageCount: 1,
      }),
    ]);
    const s2 = mkSession("s2", [
      mkTurn("2026-07-05T03:00:00.000Z", {
        usage: usageOf(50, 5),
        costUSD: 0.1,
        activeTimeMs: 5_000,
        assistantMessageCount: 2,
      }),
    ]);
    const buckets = bucketize([s1, s2], "day", {
      from: jst(2026, 7, 5),
      to: jst(2026, 7, 6),
    });
    expect(buckets).toHaveLength(1);
    const b = buckets[0];
    expect(b.usage.inputTokens).toBe(350);
    expect(b.usage.outputTokens).toBe(35);
    expect(b.costUSD).toBeCloseTo(0.85, 9);
    expect(b.activeTimeMs).toBe(45_000);
    // messageCount = ターン毎に assistantMessageCount + 1（userプロンプト分）
    expect(b.messageCount).toBe(4 + 2 + 3);
    expect(b.turnCount).toBe(3);
    expect(b.sessionCount).toBe(2); // ユニークセッション数
  });
});
