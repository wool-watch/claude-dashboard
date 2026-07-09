"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTokens, formatUSD } from "@/components/format";
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID,
  CHART_TOOLTIP_PROPS,
} from "@/components/charts/theme";
import { toChartData } from "@/components/charts/transform";
import type { Granularity, TimeBucket } from "@/lib/types";

const COST_NAME = "コスト";

export function TimeseriesChart({
  buckets,
  granularity,
}: {
  buckets: TimeBucket[];
  granularity: Granularity;
}) {
  const data = toChartData(buckets, granularity);
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={CHART_AXIS_TICK}
          axisLine={{ stroke: CHART_GRID }}
          tickLine={{ stroke: CHART_GRID }}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="tokens"
          tickFormatter={(v: number) => formatTokens(v)}
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <YAxis
          yAxisId="cost"
          orientation="right"
          tickFormatter={(v: number) => `$${v}`}
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip
          {...CHART_TOOLTIP_PROPS}
          cursor={CHART_CURSOR}
          formatter={(value, name) =>
            name === COST_NAME
              ? formatUSD(Number(value ?? 0))
              : formatTokens(Number(value ?? 0))
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="tokens" dataKey="input" name="入力" stackId="t" fill="var(--chart-1)" />
        <Bar yAxisId="tokens" dataKey="output" name="出力" stackId="t" fill="var(--chart-2)" />
        <Bar yAxisId="tokens" dataKey="cacheWrite" name="キャッシュ書込" stackId="t" fill="var(--chart-3)" />
        <Bar yAxisId="tokens" dataKey="cacheRead" name="キャッシュ読取" stackId="t" fill="var(--chart-neutral)" />
        <Line
          yAxisId="cost"
          dataKey="costUSD"
          name={COST_NAME}
          stroke="var(--chart-4)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
