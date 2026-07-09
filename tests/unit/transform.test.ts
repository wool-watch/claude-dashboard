import { describe, expect, it } from "vitest";
import { bucketLabel, toChartData } from "@/components/charts/transform";
import { emptyUsage, type TimeBucket } from "@/lib/types";

describe("bucketLabel", () => {
  it("粒度別のラベル", () => {
    expect(bucketLabel("2026-07-09T14:00", "hour")).toBe("7/9 14時");
    expect(bucketLabel("2026-07-09T00:00", "day")).toBe("7/9");
    expect(bucketLabel("2026-07-06T00:00", "week")).toBe("7/6週");
    expect(bucketLabel("2026-07-01T00:00", "month")).toBe("2026/7");
  });
});

describe("toChartData", () => {
  it("バケットをチャート用データに変換する（cacheWrite は 5m+1h 合算）", () => {
    const bucket: TimeBucket = {
      bucketStart: "2026-07-09T00:00",
      usage: {
        ...emptyUsage(),
        inputTokens: 100,
        outputTokens: 200,
        cacheWrite5mTokens: 30,
        cacheWrite1hTokens: 70,
        cacheReadTokens: 500,
      },
      costUSD: 1.5,
      messageCount: 10,
      turnCount: 3,
      activeTimeMs: 60_000,
      sessionCount: 1,
    };
    expect(toChartData([bucket], "day")).toEqual([
      {
        label: "7/9",
        input: 100,
        output: 200,
        cacheWrite: 100,
        cacheRead: 500,
        costUSD: 1.5,
      },
    ]);
  });
});
