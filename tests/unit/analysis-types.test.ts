import { describe, expect, it } from "vitest";
import {
  ANALYSIS_JSON_SCHEMA,
  IMPROVEMENT_CATEGORIES,
  isAnalysisResult,
  isStoredAnalysis,
} from "@/lib/analysis/types";

const validResult = () => ({
  summary: "TDDで機能を実装するセッション。計画的に進行した。",
  goodPoints: ["最初に要件を明確に伝えた"],
  improvements: [
    { point: "テスト方針を最初に共有すると良い", category: "テスト・検証" },
  ],
  scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
});

const validStored = () => ({
  schemaVersion: 1,
  sessionId: "11111111-1111-1111-1111-111111111111",
  projectId: "-proj-a",
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-07-01T00:01:10.000Z",
  costUSD: 0.01,
  result: validResult(),
});

describe("isAnalysisResult", () => {
  it("正常な結果を受理する", () => {
    expect(isAnalysisResult(validResult())).toBe(true);
  });

  it("カテゴリが enum 外なら拒否する", () => {
    const v = validResult();
    v.improvements[0].category = "存在しないカテゴリ";
    expect(isAnalysisResult(v)).toBe(false);
  });

  it.each([0, 6, 3.5, "3"])("score %s は拒否する", (score) => {
    const v = validResult() as Record<string, unknown>;
    (v.scores as Record<string, unknown>).efficiency = score;
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("goodPoints が空配列なら拒否する", () => {
    const v = validResult();
    v.goodPoints = [];
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("improvements の要素が文字列なら拒否する", () => {
    const v = validResult() as Record<string, unknown>;
    v.improvements = ["カテゴリなし改善点"];
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("必須キー欠損は拒否する", () => {
    const v = validResult() as Record<string, unknown>;
    delete v.summary;
    expect(isAnalysisResult(v)).toBe(false);
  });

  it.each([null, undefined, "text", 42])("非オブジェクト %s は拒否する", (v) => {
    expect(isAnalysisResult(v)).toBe(false);
  });
});

describe("isStoredAnalysis", () => {
  it("正常な保存形式を受理する", () => {
    expect(isStoredAnalysis(validStored())).toBe(true);
  });

  it("costUSD が null でも受理する", () => {
    const v = validStored();
    (v as Record<string, unknown>).costUSD = null;
    expect(isStoredAnalysis(v)).toBe(true);
  });

  it("schemaVersion 不一致は拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    v.schemaVersion = 2;
    expect(isStoredAnalysis(v)).toBe(false);
  });

  it("result が不正なら拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    v.result = { summary: "のみ" };
    expect(isStoredAnalysis(v)).toBe(false);
  });

  it("model が不正なら拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    v.model = "opus";
    expect(isStoredAnalysis(v)).toBe(false);
  });
});

describe("ANALYSIS_JSON_SCHEMA", () => {
  it("カテゴリ enum が IMPROVEMENT_CATEGORIES と一致する", () => {
    const schema = ANALYSIS_JSON_SCHEMA as {
      properties: {
        improvements: {
          items: { properties: { category: { enum: string[] } } };
        };
      };
    };
    expect(schema.properties.improvements.items.properties.category.enum).toEqual(
      [...IMPROVEMENT_CATEGORIES],
    );
  });

  it("additionalProperties を禁止している", () => {
    const schema = ANALYSIS_JSON_SCHEMA as { additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
  });
});
