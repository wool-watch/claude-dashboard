import { describe, expect, it } from "vitest";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";
import type { SessionMetrics } from "@/lib/analysis/metrics";
import type {
  ImprovementCategory,
  StoredAnalysis,
} from "@/lib/analysis/types";
import { mkAnalysisResult, mkMetrics, mkStoredAnalysis } from "./helpers";

let seq = 0;

const mk = (over: {
  sessionLastAt: string;
  /** [planning, contextProvision, verification, trajectoryStability, scopeDiscipline] */
  scores?: [number, number, number, number, number];
  categories?: ImprovementCategory[];
  goodPoints?: string[];
  metrics?: Partial<SessionMetrics>;
}): StoredAnalysis => {
  seq += 1;
  const [p, c, v, t, s] = over.scores ?? [3, 3, 3, 3, 3];
  return mkStoredAnalysis(
    `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    {
      sessionLastAt: over.sessionLastAt,
      metrics: mkMetrics(over.metrics),
      result: mkAnalysisResult({
        goodPoints: over.goodPoints ?? ["良い点"],
        improvements: (over.categories ?? ["その他"]).map((category, i) => ({
          action: `改善アクション${seq}-${i}`,
          category,
        })),
        scores: {
          planning: p,
          contextProvision: c,
          verification: v,
          trajectoryStability: t,
          scopeDiscipline: s,
        },
      }),
    },
  );
};

describe("aggregateAnalyses", () => {
  it("空配列は analyzedCount 0・avgScores null", () => {
    const dto = aggregateAnalyses([]);
    expect(dto.analyzedCount).toBe(0);
    expect(dto.avgScores).toBeNull();
    expect(dto.categoryRanking).toEqual([]);
    expect(dto.weeklyScoreTrend).toEqual([]);
    expect(dto.weeklyMetricsTrend).toEqual([]);
    expect(dto.recentGoodPoints).toEqual([]);
    expect(dto.recentImprovements).toEqual([]);
  });

  it("5軸の平均スコアを計算する", () => {
    const dto = aggregateAnalyses([
      mk({ sessionLastAt: "2026-07-01T10:00:00.000Z", scores: [2, 4, 5, 1, 3] }),
      mk({ sessionLastAt: "2026-07-02T10:00:00.000Z", scores: [4, 2, 3, 3, 5] }),
    ]);
    expect(dto.analyzedCount).toBe(2);
    expect(dto.avgScores).toEqual({
      planning: 3,
      contextProvision: 3,
      verification: 4,
      trajectoryStability: 2,
      scopeDiscipline: 4,
    });
  });

  it("カテゴリを重複込みでカウントし降順に並べ ratio を付ける", () => {
    const dto = aggregateAnalyses([
      mk({
        sessionLastAt: "2026-07-01T10:00:00.000Z",
        categories: ["計画不足", "検証不足"],
      }),
      mk({
        sessionLastAt: "2026-07-02T10:00:00.000Z",
        categories: ["計画不足"],
      }),
      mk({
        sessionLastAt: "2026-07-03T10:00:00.000Z",
        categories: ["計画不足", "その他"],
      }),
    ]);
    expect(dto.categoryRanking[0]).toEqual({
      category: "計画不足",
      count: 3,
      ratio: 0.6, // 3/5件
    });
    expect(dto.categoryRanking.map((r) => r.category)).toHaveLength(3);
  });

  it("週次トレンドは月曜始まりの JST 週でグループ化される", () => {
    const dto = aggregateAnalyses([
      // JST 2026-07-05(日) 23:00 → 週開始 6/29(月)
      mk({ sessionLastAt: "2026-07-05T14:00:00.000Z", scores: [2, 2, 2, 2, 2] }),
      // JST 2026-07-06(月) 00:30 → 週開始 7/6(月)
      mk({ sessionLastAt: "2026-07-05T15:30:00.000Z", scores: [4, 4, 4, 4, 4] }),
    ]);
    expect(dto.weeklyScoreTrend).toHaveLength(2);
    expect(dto.weeklyScoreTrend[0].weekStart).toBe("2026-06-29");
    expect(dto.weeklyScoreTrend[0].avgScores.verification).toBe(2);
    expect(dto.weeklyScoreTrend[1].weekStart).toBe("2026-07-06");
    expect(dto.weeklyScoreTrend[1].count).toBe(1);
  });

  it("週次メトリクストレンド: 効率系は週内の合計同士の比で計算する", () => {
    const dto = aggregateAnalyses([
      mk({
        sessionLastAt: "2026-07-01T10:00:00.000Z",
        metrics: {
          costUSD: 1,
          estimatedLinesAdded: 100,
          estimatedLinesRemoved: 0,
          activeTimeMs: 1_800_000, // 0.5h
          toolResultCount: 10,
          toolErrorCount: 1,
          inputTokens: 1_000,
          cacheReadTokens: 9_000,
        },
      }),
      mk({
        sessionLastAt: "2026-07-02T10:00:00.000Z",
        metrics: {
          costUSD: 3,
          estimatedLinesAdded: 250,
          estimatedLinesRemoved: 50,
          activeTimeMs: 5_400_000, // 1.5h
          toolResultCount: 10,
          toolErrorCount: 3,
          inputTokens: 5_000,
          cacheReadTokens: 5_000,
        },
      }),
    ]);
    expect(dto.weeklyMetricsTrend).toHaveLength(1);
    const week = dto.weeklyMetricsTrend[0];
    expect(week.weekStart).toBe("2026-06-29");
    expect(week.count).toBe(2);
    expect(week.totalCostUSD).toBe(4);
    expect(week.totalLinesChanged).toBe(400);
    expect(week.linesPerUSD).toBeCloseTo(100); // 400行 / $4（比率の平均ではない）
    expect(week.linesPerActiveHour).toBeCloseTo(200); // 400行 / 2h
    expect(week.avgToolErrorRate).toBeCloseTo(0.2); // (0.1 + 0.3) / 2
    expect(week.avgCacheReadRatio).toBeCloseTo(0.7); // (0.9 + 0.5) / 2
  });

  it("週次メトリクストレンド: 分母ゼロの週は null", () => {
    const dto = aggregateAnalyses([
      mk({
        sessionLastAt: "2026-07-01T10:00:00.000Z",
        metrics: {
          costUSD: 0,
          estimatedLinesAdded: 0,
          estimatedLinesRemoved: 0,
          activeTimeMs: 0,
          toolResultCount: 0,
          toolErrorCount: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
        },
      }),
    ]);
    const week = dto.weeklyMetricsTrend[0];
    expect(week.totalCostUSD).toBe(0);
    expect(week.totalLinesChanged).toBe(0);
    expect(week.linesPerUSD).toBeNull();
    expect(week.linesPerActiveHour).toBeNull();
    expect(week.avgToolErrorRate).toBeNull();
    expect(week.avgCacheReadRatio).toBeNull();
  });

  it("recent 系は sessionLastAt 降順・最大5件、improvements は action を持つ", () => {
    const analyses = Array.from({ length: 7 }, (_, i) =>
      mk({
        sessionLastAt: `2026-07-0${i + 1}T10:00:00.000Z`,
        goodPoints: [`良い点-day${i + 1}`],
      }),
    );
    const dto = aggregateAnalyses(analyses);
    expect(dto.recentGoodPoints).toHaveLength(5);
    expect(dto.recentGoodPoints[0]).toBe("良い点-day7"); // 最新が先頭
    expect(dto.recentImprovements).toHaveLength(5);
    expect(dto.recentImprovements[0].action).toContain("改善アクション");
  });
});
