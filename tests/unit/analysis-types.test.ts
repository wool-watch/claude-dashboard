import { describe, expect, it } from "vitest";
import type { SessionMetrics } from "@/lib/analysis/metrics";
import {
  ANALYSIS_JSON_SCHEMA,
  IMPROVEMENT_CATEGORIES,
  isAnalysisResult,
  isLegacyStoredAnalysis,
  isStoredAnalysis,
} from "@/lib/analysis/types";

const validMetrics = (): SessionMetrics => ({
  editedFileCount: 3,
  editOpCount: 4,
  estimatedLinesAdded: 120,
  estimatedLinesRemoved: 80,
  interruptionCount: 1,
  reEditedFileCount: 1,
  maxEditsPerFile: 2,
  toolResultCount: 8,
  toolErrorCount: 2,
  testRunCount: 2,
  testFailCount: 1,
  durationMs: 3_600_000,
  activeTimeMs: 1_800_000,
  costUSD: 2,
  totalTokens: 100_000,
  inputTokens: 10_000,
  cacheReadTokens: 40_000,
  sidechainMessageCount: 0,
  turnCount: 5,
});

const validResult = () => ({
  summary: "TDDで機能を実装するセッション。計画的に進行した。",
  goodPoints: ["最初に要件を明確に伝えた"],
  improvements: [
    { action: "着手前に完了条件と対象ファイル一覧を提示させる", category: "計画不足" },
  ],
  scores: {
    planning: 4,
    contextProvision: 3,
    verification: 5,
    trajectoryStability: 4,
    scopeDiscipline: 3,
  },
});

const validStored = () => ({
  schemaVersion: 2,
  sessionId: "11111111-1111-1111-1111-111111111111",
  projectId: "-proj-a",
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-07-01T00:01:10.000Z",
  costUSD: 0.01,
  metrics: validMetrics(),
  result: validResult(),
});

/** 移行前に保存されていた v1 形式のサンプル */
const legacyStored = () => ({
  schemaVersion: 1,
  sessionId: "22222222-2222-2222-2222-222222222222",
  projectId: "-proj-b",
  analyzedAt: "2026-06-01T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-05-31T00:00:00.000Z",
  costUSD: null,
  result: {
    summary: "旧形式の分析",
    goodPoints: ["良かった点"],
    improvements: [
      { point: "テスト方針を最初に共有すると良い", category: "テスト・検証" },
    ],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

describe("isAnalysisResult (v2)", () => {
  it("正常な結果を受理する", () => {
    expect(isAnalysisResult(validResult())).toBe(true);
  });

  it("カテゴリが enum 外（旧カテゴリ含む）なら拒否する", () => {
    const v = validResult();
    v.improvements[0].category = "テスト・検証"; // v1 のカテゴリ
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("旧 v1 の3軸スコアは拒否する", () => {
    const v = validResult() as Record<string, unknown>;
    v.scores = { instructionClarity: 4, efficiency: 3, goalAchievement: 5 };
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("improvements の要素が point キー（v1 形式）なら拒否する", () => {
    const v = validResult() as Record<string, unknown>;
    v.improvements = [{ point: "旧形式", category: "計画不足" }];
    expect(isAnalysisResult(v)).toBe(false);
  });

  it.each([0, 6, 3.5, "3"])("score %s は拒否する", (score) => {
    const v = validResult() as Record<string, unknown>;
    (v.scores as Record<string, unknown>).verification = score;
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("スコア軸の欠損は拒否する", () => {
    const v = validResult() as Record<string, unknown>;
    delete (v.scores as Record<string, unknown>).scopeDiscipline;
    expect(isAnalysisResult(v)).toBe(false);
  });

  it("goodPoints が空配列なら拒否する", () => {
    const v = validResult();
    v.goodPoints = [];
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

describe("isStoredAnalysis (v2)", () => {
  it("正常な保存形式を受理する", () => {
    expect(isStoredAnalysis(validStored())).toBe(true);
  });

  it("costUSD が null でも受理する", () => {
    const v = validStored();
    (v as Record<string, unknown>).costUSD = null;
    expect(isStoredAnalysis(v)).toBe(true);
  });

  it("schemaVersion 1（旧形式）は拒否する", () => {
    expect(isStoredAnalysis(legacyStored())).toBe(false);
  });

  it("metrics 欠損・不正は拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    delete v.metrics;
    expect(isStoredAnalysis(v)).toBe(false);
    const v2 = validStored() as Record<string, unknown>;
    v2.metrics = { editOpCount: -1 };
    expect(isStoredAnalysis(v2)).toBe(false);
  });

  it("result が不正なら拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    v.result = { summary: "のみ" };
    expect(isStoredAnalysis(v)).toBe(false);
  });

  it("model は任意の非空文字列を受理・空文字は拒否する", () => {
    const v = validStored() as Record<string, unknown>;
    v.model = "qwen3-8b";
    expect(isStoredAnalysis(v)).toBe(true);
    v.model = "";
    expect(isStoredAnalysis(v)).toBe(false);
  });

  it("provider は省略可・既知IDのみ受理する", () => {
    const v = validStored() as Record<string, unknown>;
    expect(isStoredAnalysis(v)).toBe(true);
    v.provider = "lmstudio";
    expect(isStoredAnalysis(v)).toBe(true);
    v.provider = "chatgpt";
    expect(isStoredAnalysis(v)).toBe(false);
  });
});

describe("isLegacyStoredAnalysis", () => {
  it("v1 の保存形式を legacy として認識する", () => {
    expect(isLegacyStoredAnalysis(legacyStored())).toBe(true);
  });

  it("v2 の保存形式は legacy ではない", () => {
    expect(isLegacyStoredAnalysis(validStored())).toBe(false);
  });

  it("sessionId / projectId 欠損や非オブジェクトは拒否する", () => {
    expect(isLegacyStoredAnalysis({ schemaVersion: 1 })).toBe(false);
    expect(isLegacyStoredAnalysis(null)).toBe(false);
    expect(isLegacyStoredAnalysis("v1")).toBe(false);
  });
});

describe("ANALYSIS_JSON_SCHEMA (v2)", () => {
  it("カテゴリ enum が IMPROVEMENT_CATEGORIES と一致する", () => {
    const schema = ANALYSIS_JSON_SCHEMA as unknown as {
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

  it("improvements items は action を必須にする", () => {
    const schema = ANALYSIS_JSON_SCHEMA as unknown as {
      properties: { improvements: { items: { required: string[] } } };
    };
    expect(schema.properties.improvements.items.required).toEqual([
      "action",
      "category",
    ]);
  });

  it("scores はハーネス実践5軸を必須にする", () => {
    const schema = ANALYSIS_JSON_SCHEMA as unknown as {
      properties: { scores: { required: string[] } };
    };
    expect(schema.properties.scores.required).toEqual([
      "planning",
      "contextProvision",
      "verification",
      "trajectoryStability",
      "scopeDiscipline",
    ]);
  });

  it("additionalProperties を禁止している（openai-compat strict 互換）", () => {
    const schema = ANALYSIS_JSON_SCHEMA as { additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
  });
});
