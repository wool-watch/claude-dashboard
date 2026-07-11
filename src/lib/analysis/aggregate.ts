import { format, startOfWeek } from "date-fns";
import {
  cacheReadRatio,
  toolErrorRate,
  type SessionMetrics,
} from "@/lib/analysis/metrics";
import type {
  AnalysisScores,
  ImprovementCategory,
  ImprovementItem,
  StoredAnalysis,
} from "@/lib/analysis/types";
import { SCORE_KEYS } from "@/lib/analysis/types";

export interface WeeklyMetricsTrendEntry {
  /** 月曜始まりの週開始日 yyyy-MM-dd（ローカルTZ） */
  weekStart: string;
  count: number;
  totalCostUSD: number;
  /** 推定変更行数（added + removed）の週合計 */
  totalLinesChanged: number;
  /** コスト効率: 週合計の行数 / 週合計の USD（比率の平均ではない） */
  linesPerUSD: number | null;
  /** 工数効率: 週合計の行数 / 週合計のアクティブ時間(h) */
  linesPerActiveHour: number | null;
  /** 品質シグナル: セッションごとのツールエラー率の平均 */
  avgToolErrorRate: number | null;
  /** 節約指標: セッションごとのキャッシュ読取比率の平均 */
  avgCacheReadRatio: number | null;
}

export interface AnalysisSummaryDto {
  analyzedCount: number;
  /** 0件なら null。丸めはUI側で行う */
  avgScores: AnalysisScores | null;
  categoryRanking: Array<{
    category: ImprovementCategory;
    count: number;
    /** 全改善点件数に対する割合 */
    ratio: number;
  }>;
  weeklyScoreTrend: Array<{
    /** 月曜始まりの週開始日 yyyy-MM-dd（ローカルTZ） */
    weekStart: string;
    avgScores: AnalysisScores;
    count: number;
  }>;
  weeklyMetricsTrend: WeeklyMetricsTrendEntry[];
  /** sessionLastAt 降順の最新5件 */
  recentGoodPoints: string[];
  recentImprovements: ImprovementItem[];
  generatedAt: string;
}

function meanScores(list: AnalysisScores[]): AnalysisScores {
  const sum: Record<string, number> = {};
  for (const key of SCORE_KEYS) sum[key] = 0;
  for (const s of list) {
    for (const key of SCORE_KEYS) sum[key] += s[key];
  }
  const out: Record<string, number> = {};
  for (const key of SCORE_KEYS) out[key] = sum[key] / list.length;
  return out as unknown as AnalysisScores;
}

const linesChanged = (m: SessionMetrics): number =>
  m.estimatedLinesAdded + m.estimatedLinesRemoved;

const meanOrNull = (values: Array<number | null>): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length > 0
    ? nums.reduce((a, b) => a + b, 0) / nums.length
    : null;
};

function toWeeklyMetrics(
  weekStart: string,
  metrics: SessionMetrics[],
): WeeklyMetricsTrendEntry {
  const totalCostUSD = metrics.reduce((a, m) => a + m.costUSD, 0);
  const totalLinesChanged = metrics.reduce((a, m) => a + linesChanged(m), 0);
  const totalActiveHours =
    metrics.reduce((a, m) => a + m.activeTimeMs, 0) / 3_600_000;
  return {
    weekStart,
    count: metrics.length,
    totalCostUSD,
    totalLinesChanged,
    linesPerUSD: totalCostUSD > 0 ? totalLinesChanged / totalCostUSD : null,
    linesPerActiveHour:
      totalActiveHours > 0 ? totalLinesChanged / totalActiveHours : null,
    avgToolErrorRate: meanOrNull(metrics.map(toolErrorRate)),
    avgCacheReadRatio: meanOrNull(metrics.map(cacheReadRatio)),
  };
}

const weekStartOf = (iso: string): string =>
  format(startOfWeek(new Date(iso), { weekStartsOn: 1 }), "yyyy-MM-dd");

export function aggregateAnalyses(
  analyses: StoredAnalysis[],
  now: Date = new Date(),
): AnalysisSummaryDto {
  const generatedAt = now.toISOString();
  if (analyses.length === 0) {
    return {
      analyzedCount: 0,
      avgScores: null,
      categoryRanking: [],
      weeklyScoreTrend: [],
      weeklyMetricsTrend: [],
      recentGoodPoints: [],
      recentImprovements: [],
      generatedAt,
    };
  }

  // カテゴリ集計（改善点1件を1カウント）
  const allImprovements = analyses.flatMap((a) => a.result.improvements);
  const counts = new Map<ImprovementCategory, number>();
  for (const item of allImprovements) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  const categoryRanking = [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      ratio: count / allImprovements.length,
    }))
    .sort((a, b) => b.count - a.count);

  // 週次トレンド（sessionLastAt を月曜始まりの週へ）
  const byWeek = new Map<string, StoredAnalysis[]>();
  for (const a of analyses) {
    const weekStart = weekStartOf(a.sessionLastAt);
    const list = byWeek.get(weekStart) ?? [];
    list.push(a);
    byWeek.set(weekStart, list);
  }
  const sortedWeeks = [...byWeek.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const weeklyScoreTrend = sortedWeeks.map(([weekStart, list]) => ({
    weekStart,
    avgScores: meanScores(list.map((a) => a.result.scores)),
    count: list.length,
  }));
  const weeklyMetricsTrend = sortedWeeks.map(([weekStart, list]) =>
    toWeeklyMetrics(
      weekStart,
      list.map((a) => a.metrics),
    ),
  );

  const latestFirst = [...analyses].sort((a, b) =>
    b.sessionLastAt.localeCompare(a.sessionLastAt),
  );

  return {
    analyzedCount: analyses.length,
    avgScores: meanScores(analyses.map((a) => a.result.scores)),
    categoryRanking,
    weeklyScoreTrend,
    weeklyMetricsTrend,
    recentGoodPoints: latestFirst
      .flatMap((a) => a.result.goodPoints)
      .slice(0, 5),
    recentImprovements: latestFirst
      .flatMap((a) => a.result.improvements)
      .slice(0, 5),
    generatedAt,
  };
}
