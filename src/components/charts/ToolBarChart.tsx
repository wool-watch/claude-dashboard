"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID,
  CHART_TOOLTIP_PROPS,
} from "@/components/charts/theme";
import { EmptyState } from "@/components/ui";
import type { ToolStats } from "@/lib/types";

const TOP_N = 15;

export function ToolBarChart({ tools }: { tools: ToolStats[] }) {
  const data = tools.slice(0, TOP_N);
  if (data.length === 0) return <EmptyState />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis
          type="number"
          tick={CHART_AXIS_TICK}
          axisLine={{ stroke: CHART_GRID }}
          tickLine={{ stroke: CHART_GRID }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="tool"
          width={180}
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip {...CHART_TOOLTIP_PROPS} cursor={CHART_CURSOR} />
        <Bar dataKey="count" name="呼出回数" fill="var(--chart-1)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
