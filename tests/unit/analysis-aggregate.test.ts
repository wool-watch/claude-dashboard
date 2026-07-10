import { describe, expect, it } from "vitest";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";
import type {
  ImprovementCategory,
  StoredAnalysis,
} from "@/lib/analysis/types";

let seq = 0;

const mk = (over: {
  sessionLastAt: string;
  scores?: [number, number, number];
  categories?: ImprovementCategory[];
  goodPoints?: string[];
}): StoredAnalysis => {
  seq += 1;
  const [c, e, g] = over.scores ?? [3, 3, 3];
  return {
    schemaVersion: 1,
    sessionId: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    projectId: "-proj-a",
    analyzedAt: "2026-07-10T00:00:00.000Z",
    model: "haiku",
    sourceMtimeMs: 1,
    sourceSize: 1,
    sessionLastAt: over.sessionLastAt,
    costUSD: null,
    result: {
      summary: "要約。",
      goodPoints: over.goodPoints ?? ["良い点"],
      improvements: (over.categories ?? ["その他"]).map((category, i) => ({
        point: `改善点${seq}-${i}`,
        category,
      })),
      scores: { instructionClarity: c, efficiency: e, goalAchievement: g },
    },
  };
};

describe("aggregateAnalyses", () => {
  it("空配列は analyzedCount 0・avgScores null", () => {
    const dto = aggregateAnalyses([]);
    expect(dto.analyzedCount).toBe(0);
    expect(dto.avgScores).toBeNull();
    expect(dto.categoryRanking).toEqual([]);
    expect(dto.weeklyScoreTrend).toEqual([]);
    expect(dto.recentGoodPoints).toEqual([]);
    expect(dto.recentImprovements).toEqual([]);
  });

  it("平均スコアを計算する", () => {
    const dto = aggregateAnalyses([
      mk({ sessionLastAt: "2026-07-01T10:00:00.000Z", scores: [2, 4, 5] }),
      mk({ sessionLastAt: "2026-07-02T10:00:00.000Z", scores: [4, 2, 3] }),
    ]);
    expect(dto.analyzedCount).toBe(2);
    expect(dto.avgScores).toEqual({
      instructionClarity: 3,
      efficiency: 3,
      goalAchievement: 4,
    });
  });

  it("カテゴリを重複込みでカウントし降順に並べ ratio を付ける", () => {
    const dto = aggregateAnalyses([
      mk({
        sessionLastAt: "2026-07-01T10:00:00.000Z",
        categories: ["タスク分割", "テスト・検証"],
      }),
      mk({
        sessionLastAt: "2026-07-02T10:00:00.000Z",
        categories: ["タスク分割"],
      }),
      mk({
        sessionLastAt: "2026-07-03T10:00:00.000Z",
        categories: ["タスク分割", "その他"],
      }),
    ]);
    expect(dto.categoryRanking[0]).toEqual({
      category: "タスク分割",
      count: 3,
      ratio: 0.6, // 3/5件
    });
    expect(dto.categoryRanking.map((r) => r.category)).toHaveLength(3);
  });

  it("週次トレンドは月曜始まりの JST 週でグループ化される", () => {
    const dto = aggregateAnalyses([
      // JST 2026-07-05(日) 23:00 → 週開始 6/29(月)
      mk({ sessionLastAt: "2026-07-05T14:00:00.000Z", scores: [2, 2, 2] }),
      // JST 2026-07-06(月) 00:30 → 週開始 7/6(月)
      mk({ sessionLastAt: "2026-07-05T15:30:00.000Z", scores: [4, 4, 4] }),
    ]);
    expect(dto.weeklyScoreTrend).toHaveLength(2);
    expect(dto.weeklyScoreTrend[0].weekStart).toBe("2026-06-29");
    expect(dto.weeklyScoreTrend[0].avgScores.efficiency).toBe(2);
    expect(dto.weeklyScoreTrend[1].weekStart).toBe("2026-07-06");
    expect(dto.weeklyScoreTrend[1].count).toBe(1);
  });

  it("recent 系は sessionLastAt 降順・最大5件", () => {
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
  });
});
