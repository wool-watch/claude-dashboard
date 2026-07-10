"use client";

import {
  Bar,
  BarChart,
  Line,
  LineChart,
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
import { Badge, EmptyState, ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { AnalysisSummaryDto } from "@/lib/analysis/aggregate";

function AvgScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">
        {value.toFixed(1)}
        <span className="text-xs font-normal text-black/40 dark:text-white/40">
          /5
        </span>
      </div>
    </div>
  );
}

function SummaryBody({ dto }: { dto: AnalysisSummaryDto }) {
  if (dto.analyzedCount === 0 || dto.avgScores === null) {
    return (
      <EmptyState message="セッション詳細ページの「AI振り返り」から分析を実行すると、ここに傾向が表示されます" />
    );
  }

  const trend = dto.weeklyScoreTrend.map((w) => ({
    weekStart: w.weekStart.slice(5), // MM-dd
    指示の明確さ: Number(w.avgScores.instructionClarity.toFixed(2)),
    進行の効率: Number(w.avgScores.efficiency.toFixed(2)),
    目的の達成度: Number(w.avgScores.goalAchievement.toFixed(2)),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <div className="text-xs text-black/50 dark:text-white/50">
            分析済みセッション
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {dto.analyzedCount}
          </div>
        </div>
        <AvgScoreCard label="指示の明確さ（平均）" value={dto.avgScores.instructionClarity} />
        <AvgScoreCard label="進行の効率（平均）" value={dto.avgScores.efficiency} />
        <AvgScoreCard label="目的の達成度（平均）" value={dto.avgScores.goalAchievement} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
            改善カテゴリの頻度
          </h3>
          <ResponsiveContainer
            width="100%"
            height={Math.max(120, dto.categoryRanking.length * 28)}
          >
            <BarChart
              data={dto.categoryRanking}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <XAxis
                type="number"
                tick={CHART_AXIS_TICK}
                axisLine={{ stroke: CHART_GRID }}
                tickLine={{ stroke: CHART_GRID }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="category"
                width={130}
                tick={CHART_AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...CHART_TOOLTIP_PROPS} cursor={CHART_CURSOR} />
              <Bar
                dataKey="count"
                name="件数"
                fill="var(--chart-1)"
                radius={[0, 3, 3, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
            週次スコア推移
          </h3>
          {trend.length < 2 ? (
            <EmptyState message="2週間分以上の分析が集まると推移が表示されます" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend} margin={{ left: 8, right: 16 }}>
                <XAxis
                  dataKey="weekStart"
                  tick={CHART_AXIS_TICK}
                  axisLine={{ stroke: CHART_GRID }}
                  tickLine={{ stroke: CHART_GRID }}
                />
                <YAxis
                  domain={[1, 5]}
                  tick={CHART_AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                />
                <Tooltip {...CHART_TOOLTIP_PROPS} cursor={CHART_CURSOR} />
                <Line
                  type="monotone"
                  dataKey="指示の明確さ"
                  stroke="var(--chart-1)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="進行の効率"
                  stroke="var(--chart-2)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="目的の達成度"
                  stroke="var(--chart-3)"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
          最近の改善ポイント
        </h3>
        <ul className="space-y-1 text-sm">
          {dto.recentImprovements.map((item) => (
            <li key={item.point} className="flex flex-wrap items-center gap-1.5">
              <Badge tone="amber">{item.category}</Badge>
              <span>{item.point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AnalysisSummarySection() {
  const summary = useApi<AnalysisSummaryDto>("/api/analysis/summary");

  return (
    <Section title="振り返りサマリー（AI分析の傾向）">
      {summary.error !== null && <ErrorNote message={summary.error} />}
      {summary.loading ? (
        <Skeleton className="h-40" />
      ) : (
        summary.data !== null && <SummaryBody dto={summary.data} />
      )}
    </Section>
  );
}
