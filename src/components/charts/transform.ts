import type { Granularity, TimeBucket } from "@/lib/types";

export interface ChartPoint {
  label: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUSD: number;
}

/** bucketStart（"yyyy-MM-dd'T'HH:mm" ローカルTZ）を粒度別の軸ラベルにする */
export function bucketLabel(bucketStart: string, granularity: Granularity): string {
  const [datePart, timePart] = bucketStart.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const hour = Number(timePart?.split(":")[0] ?? 0);
  switch (granularity) {
    case "hour":
      return `${month}/${day} ${hour}時`;
    case "day":
      return `${month}/${day}`;
    case "week":
      return `${month}/${day}週`;
    case "month":
      return `${year}/${month}`;
  }
}

export function toChartData(
  buckets: TimeBucket[],
  granularity: Granularity,
): ChartPoint[] {
  return buckets.map((b) => ({
    label: bucketLabel(b.bucketStart, granularity),
    input: b.usage.inputTokens,
    output: b.usage.outputTokens,
    cacheWrite: b.usage.cacheWrite5mTokens + b.usage.cacheWrite1hTokens,
    cacheRead: b.usage.cacheReadTokens,
    costUSD: b.costUSD,
  }));
}
