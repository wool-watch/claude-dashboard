"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatTokens, formatUSD } from "@/components/format";
import { CHART_COLORS, CHART_TOOLTIP_PROPS } from "@/components/charts/theme";
import { Badge, EmptyState } from "@/components/ui";
import { type ModelStats, totalTokens } from "@/lib/types";

export function ModelPieChart({ models }: { models: ModelStats[] }) {
  const withCost = models.filter((m) => m.costUSD > 0);
  if (models.length === 0) return <EmptyState />;

  return (
    <div>
      {withCost.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={withCost}
              dataKey="costUSD"
              nameKey="model"
              innerRadius={45}
              outerRadius={80}
              paddingAngle={2}
            >
              {withCost.map((m, i) => (
                <Cell key={m.model} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              {...CHART_TOOLTIP_PROPS}
              formatter={(v) => formatUSD(Number(v ?? 0))}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      <table className="mt-2 w-full text-xs">
        <thead className="text-black/50 dark:text-white/50">
          <tr>
            <th className="py-1 text-left">モデル</th>
            <th className="py-1 text-right">トークン</th>
            <th className="py-1 text-right">リクエスト</th>
            <th className="py-1 text-right">コスト</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model} className="border-t border-black/5 dark:border-white/10">
              <td className="py-1">
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      m.costUSD > 0
                        ? CHART_COLORS[withCost.indexOf(m) % CHART_COLORS.length]
                        : "var(--chart-neutral)",
                  }}
                />
                {m.model}
                {m.isEstimated && (
                  <span className="ml-1">
                    <Badge tone="amber">推定</Badge>
                  </span>
                )}
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatTokens(totalTokens(m.usage))}
              </td>
              <td className="py-1 text-right tabular-nums">{m.requestCount}</td>
              <td className="py-1 text-right tabular-nums">
                {formatUSD(m.costUSD)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
