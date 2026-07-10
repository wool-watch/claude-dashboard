import { format, startOfWeek } from "date-fns";
import type {
  AnalysisScores,
  ImprovementCategory,
  ImprovementItem,
  StoredAnalysis,
} from "@/lib/analysis/types";

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
  /** sessionLastAt 降順の最新5件 */
  recentGoodPoints: string[];
  recentImprovements: ImprovementItem[];
  generatedAt: string;
}

const ZERO: AnalysisScores = {
  instructionClarity: 0,
  efficiency: 0,
  goalAchievement: 0,
};

function meanScores(list: AnalysisScores[]): AnalysisScores {
  const sum = list.reduce(
    (acc, s) => ({
      instructionClarity: acc.instructionClarity + s.instructionClarity,
      efficiency: acc.efficiency + s.efficiency,
      goalAchievement: acc.goalAchievement + s.goalAchievement,
    }),
    ZERO,
  );
  return {
    instructionClarity: sum.instructionClarity / list.length,
    efficiency: sum.efficiency / list.length,
    goalAchievement: sum.goalAchievement / list.length,
  };
}

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
  const byWeek = new Map<string, AnalysisScores[]>();
  for (const a of analyses) {
    const weekStart = format(
      startOfWeek(new Date(a.sessionLastAt), { weekStartsOn: 1 }),
      "yyyy-MM-dd",
    );
    const list = byWeek.get(weekStart) ?? [];
    list.push(a.result.scores);
    byWeek.set(weekStart, list);
  }
  const weeklyScoreTrend = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, scores]) => ({
      weekStart,
      avgScores: meanScores(scores),
      count: scores.length,
    }));

  const latestFirst = [...analyses].sort((a, b) =>
    b.sessionLastAt.localeCompare(a.sessionLastAt),
  );

  return {
    analyzedCount: analyses.length,
    avgScores: meanScores(analyses.map((a) => a.result.scores)),
    categoryRanking,
    weeklyScoreTrend,
    recentGoodPoints: latestFirst
      .flatMap((a) => a.result.goodPoints)
      .slice(0, 5),
    recentImprovements: latestFirst
      .flatMap((a) => a.result.improvements)
      .slice(0, 5),
    generatedAt,
  };
}
