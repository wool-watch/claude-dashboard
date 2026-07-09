import { describe, expect, it } from "vitest";
import {
  heatLevel,
  monthLabels,
  toCalendarWeeks,
  trimLeadingEmptyWeeks,
} from "@/components/charts/heatmap-transform";
import { emptyUsage, type TimeBucket } from "@/lib/types";

const dayBucket = (date: string, tokens = 0): TimeBucket => ({
  bucketStart: `${date}T00:00`,
  usage: { ...emptyUsage(), inputTokens: tokens },
  costUSD: 0,
  messageCount: 0,
  turnCount: tokens > 0 ? 1 : 0,
  activeTimeMs: 0,
  sessionCount: 0,
});

/** from（両端含む開始日）から days 日分の連続日次バケット */
const range = (start: string, days: number): TimeBucket[] => {
  const [y, m, d] = start.split("-").map(Number);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(y, m - 1, d + i);
    const pad = (v: number) => String(v).padStart(2, "0");
    return dayBucket(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    );
  });
};

describe("toCalendarWeeks", () => {
  it("月曜開始のバケット列は 7日毎の週に分割される", () => {
    // 2026-06-29 は月曜
    const weeks = toCalendarWeeks(range("2026-06-29", 14));
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0][0]?.date).toBe("2026-06-29");
    expect(weeks[1][0]?.date).toBe("2026-07-06");
  });

  it("週の途中から始まる場合は先頭を null 埋めする", () => {
    // 2026-07-01 は水曜 → 月・火が null
    const weeks = toCalendarWeeks(range("2026-07-01", 5));
    expect(weeks).toHaveLength(1);
    expect(weeks[0][0]).toBeNull();
    expect(weeks[0][1]).toBeNull();
    expect(weeks[0][2]?.date).toBe("2026-07-01");
    expect(weeks[0][6]?.date).toBe("2026-07-05");
  });

  it("末尾の欠けも null 埋めして全週 7 要素にする", () => {
    const weeks = toCalendarWeeks(range("2026-06-29", 8));
    expect(weeks).toHaveLength(2);
    expect(weeks[1][0]?.date).toBe("2026-07-06");
    expect(weeks[1].slice(1)).toEqual([null, null, null, null, null, null]);
  });

  it("tokens は usage の全種別合計", () => {
    const b = dayBucket("2026-06-29", 100);
    b.usage.cacheReadTokens = 900;
    const weeks = toCalendarWeeks([b]);
    expect(weeks[0][0]?.tokens).toBe(1000);
  });

  it("空配列は空を返す", () => {
    expect(toCalendarWeeks([])).toEqual([]);
  });
});

describe("heatLevel", () => {
  it("0 と max=0 は level 0", () => {
    expect(heatLevel(0, 1000)).toBe(0);
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(100, 0)).toBe(0);
  });

  it("max は level 4、微小値は level 1", () => {
    expect(heatLevel(1000, 1000)).toBe(4);
    expect(heatLevel(1, 1_000_000)).toBe(1);
  });

  it("sqrt スケールで4段階に配分する", () => {
    const max = 1600;
    expect(heatLevel(max * 0.0625, max)).toBe(1); // sqrt=0.25
    expect(heatLevel(max * 0.25, max)).toBe(2); // sqrt=0.5
    expect(heatLevel(max * 0.5625, max)).toBe(3); // sqrt=0.75
    expect(heatLevel(max * 0.99, max)).toBe(4);
  });
});

describe("trimLeadingEmptyWeeks", () => {
  it("先頭の空週を除去し、最初にデータのある週から返す", () => {
    // 3週分（6/29〜7/19）、3週目の 7/15 だけにデータ
    const buckets = range("2026-06-29", 21);
    buckets[16] = dayBucket("2026-07-15", 500); // 3週目の水曜
    const weeks = toCalendarWeeks(buckets);
    const trimmed = trimLeadingEmptyWeeks(weeks);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0][2]?.date).toBe("2026-07-15");
    expect(trimmed[0][2]?.tokens).toBe(500);
  });

  it("全週が空なら空配列", () => {
    const weeks = toCalendarWeeks(range("2026-06-29", 14));
    expect(trimLeadingEmptyWeeks(weeks)).toEqual([]);
  });

  it("先頭週にデータがあれば不変", () => {
    const buckets = range("2026-06-29", 14);
    buckets[0] = dayBucket("2026-06-29", 100);
    const weeks = toCalendarWeeks(buckets);
    expect(trimLeadingEmptyWeeks(weeks)).toEqual(weeks);
  });
});

describe("monthLabels", () => {
  it("先頭週と月替わりの週にラベルを付ける", () => {
    // 週の先頭日: 6/22, 6/29, 7/6, 7/13
    const weeks = [
      ...toCalendarWeeks(range("2026-06-22", 28)).map((w) => w),
    ];
    expect(monthLabels(weeks)).toEqual([
      { index: 0, label: "6月" },
      { index: 2, label: "7月" },
    ]);
  });

  it("空は空配列", () => {
    expect(monthLabels([])).toEqual([]);
  });
});
