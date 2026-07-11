"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Legend,
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
import { PriorityAnalysisModal } from "@/components/PriorityAnalysisModal";
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
    計画分解: Number(w.avgScores.planning.toFixed(2)),
    コンテキスト: Number(w.avgScores.contextProvision.toFixed(2)),
    検証テスト: Number(w.avgScores.verification.toFixed(2)),
    軌道安定性: Number(w.avgScores.trajectoryStability.toFixed(2)),
    スコープ規律: Number(w.avgScores.scopeDiscipline.toFixed(2)),
  }));

  const efficiencyTrend = dto.weeklyMetricsTrend.map((w) => ({
    weekStart: w.weekStart.slice(5), // MM-dd
    "行/$": w.linesPerUSD === null ? null : Number(w.linesPerUSD.toFixed(1)),
    "行/時間":
      w.linesPerActiveHour === null
        ? null
        : Number(w.linesPerActiveHour.toFixed(1)),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <div className="text-xs text-black/50 dark:text-white/50">
            分析済みセッション
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {dto.analyzedCount}
          </div>
        </div>
        <AvgScoreCard label="計画・分解（平均）" value={dto.avgScores.planning} />
        <AvgScoreCard
          label="コンテキスト提供（平均）"
          value={dto.avgScores.contextProvision}
        />
        <AvgScoreCard label="検証・テスト（平均）" value={dto.avgScores.verification} />
        <AvgScoreCard
          label="軌道安定性（平均）"
          value={dto.avgScores.trajectoryStability}
        />
        <AvgScoreCard
          label="スコープ規律（平均）"
          value={dto.avgScores.scopeDiscipline}
        />
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
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="計画分解"
                  stroke="var(--chart-1)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="コンテキスト"
                  stroke="var(--chart-2)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="検証テスト"
                  stroke="var(--chart-3)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="軌道安定性"
                  stroke="var(--chart-4)"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="スコープ規律"
                  stroke="var(--chart-5)"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
          コスト・工数効率の推移（推定変更行数ベース）
        </h3>
        {efficiencyTrend.length < 2 ? (
          <EmptyState message="2週間分以上の分析が集まると推移が表示されます" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={efficiencyTrend} margin={{ left: 8, right: 16 }}>
              <XAxis
                dataKey="weekStart"
                tick={CHART_AXIS_TICK}
                axisLine={{ stroke: CHART_GRID }}
                tickLine={{ stroke: CHART_GRID }}
              />
              <YAxis
                tick={CHART_AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip {...CHART_TOOLTIP_PROPS} cursor={CHART_CURSOR} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="行/$"
                stroke="var(--chart-1)"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="行/時間"
                stroke="var(--chart-2)"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
          最近の改善アクション
        </h3>
        <ul className="space-y-1 text-sm">
          {dto.recentImprovements.map((item) => (
            <li key={item.action} className="flex flex-wrap items-center gap-1.5">
              <Badge tone="amber">{item.category}</Badge>
              <span>{item.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AnalysisSummarySection({ projectId }: { projectId?: string }) {
  const url =
    projectId === undefined
      ? "/api/analysis/summary"
      : `/api/analysis/summary?project=${encodeURIComponent(projectId)}`;
  const summary = useApi<AnalysisSummaryDto>(url);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Section
      title="振り返りサマリー（AI分析の傾向）"
      action={
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/70 hover:bg-black/5 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
        >
          優先課題を分析
        </button>
      }
    >
      {summary.error !== null && <ErrorNote message={summary.error} />}
      {summary.loading ? (
        <Skeleton className="h-40" />
      ) : (
        summary.data !== null && <SummaryBody dto={summary.data} />
      )}
      <PriorityAnalysisModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
      />
    </Section>
  );
}
