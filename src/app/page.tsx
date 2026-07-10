"use client";

import { format, startOfWeek, subWeeks } from "date-fns";
import { useMemo, useState } from "react";
import { AnalysisSummarySection } from "@/components/AnalysisSummarySection";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";
import { ModelPieChart } from "@/components/charts/ModelPieChart";
import { TimeseriesChart } from "@/components/charts/TimeseriesChart";
import { ToolBarChart } from "@/components/charts/ToolBarChart";
import { WeekdayHourHeatmap } from "@/components/charts/WeekdayHourHeatmap";
import { GranularityTabs } from "@/components/GranularityTabs";
import { SummaryCards } from "@/components/SummaryCards";
import { EmptyState, ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type {
  ApiSummary,
  Granularity,
  ModelStats,
  TimeBucket,
  ToolStats,
} from "@/lib/types";

export default function DashboardPage() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const summary = useApi<ApiSummary>("/api/summary");
  const timeseries = useApi<{ buckets: TimeBucket[] }>(
    `/api/timeseries?granularity=${granularity}`,
  );
  const models = useApi<{ models: ModelStats[] }>("/api/stats/models");
  const tools = useApi<{ tools: ToolStats[] }>("/api/stats/tools");

  // 過去半年（26週）を月曜開始で取得。日付のみ文字列なので日内で URL は安定
  const calendarFrom = useMemo(
    () =>
      format(
        startOfWeek(subWeeks(new Date(), 25), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      ),
    [],
  );
  const calendar = useApi<{ buckets: TimeBucket[] }>(
    `/api/timeseries?granularity=day&from=${calendarFrom}`,
  );
  const heatmap = useApi<{ cells: number[][] }>("/api/stats/heatmap");

  return (
    <div className="space-y-4">
      {summary.error !== null && <ErrorNote message={summary.error} />}
      {summary.loading ? (
        <Skeleton className="h-40" />
      ) : (
        summary.data !== null && <SummaryCards summary={summary.data} />
      )}

      <Section title="時系列推移（トークン × コスト）">
        <div className="mb-3">
          <GranularityTabs value={granularity} onChange={setGranularity} />
        </div>
        {timeseries.error !== null && <ErrorNote message={timeseries.error} />}
        {timeseries.loading ? (
          <Skeleton className="h-80" />
        ) : timeseries.data !== null &&
          timeseries.data.buckets.some((b) => b.turnCount > 0) ? (
          <TimeseriesChart
            buckets={timeseries.data.buckets}
            granularity={granularity}
          />
        ) : (
          <EmptyState message="この期間のデータがありません" />
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="日別アクティビティ（トークン数・最大過去半年）">
          {calendar.error !== null && <ErrorNote message={calendar.error} />}
          {calendar.loading ? (
            <Skeleton className="h-32" />
          ) : (
            calendar.data !== null && (
              <CalendarHeatmap buckets={calendar.data.buckets} />
            )
          )}
        </Section>
        <Section title="曜日×時間帯（トークン数・全期間）">
          {heatmap.error !== null && <ErrorNote message={heatmap.error} />}
          {heatmap.loading ? (
            <Skeleton className="h-32" />
          ) : (
            heatmap.data !== null && (
              <WeekdayHourHeatmap cells={heatmap.data.cells} />
            )
          )}
        </Section>
        <Section title="モデル別">
          {models.error !== null && <ErrorNote message={models.error} />}
          {models.loading ? (
            <Skeleton className="h-64" />
          ) : (
            models.data !== null && <ModelPieChart models={models.data.models} />
          )}
        </Section>
        <Section title="ツール別呼出回数（上位15）">
          {tools.error !== null && <ErrorNote message={tools.error} />}
          {tools.loading ? (
            <Skeleton className="h-64" />
          ) : (
            tools.data !== null && <ToolBarChart tools={tools.data.tools} />
          )}
        </Section>
      </div>

      <AnalysisSummarySection />
    </div>
  );
}
