import type { AnalysisModel } from "@/lib/settings/settings";
import { ANALYSIS_MODEL_OPTIONS } from "@/lib/settings/settings";

export const IMPROVEMENT_CATEGORIES = [
  "指示の具体性",
  "コンテキスト提供",
  "タスク分割",
  "スコープ管理",
  "テスト・検証",
  "ツール活用",
  "手戻り・軌道修正",
  "その他",
] as const;

export type ImprovementCategory = (typeof IMPROVEMENT_CATEGORIES)[number];

/** セッション一覧に出す分析ステータス（analyzing > stale > analyzed > none） */
export type SessionAnalysisStatus =
  | "analyzing"
  | "queued"
  | "analyzed"
  | "stale"
  | "none";

export interface AnalysisScores {
  /** 指示の明確さ 1..5 */
  instructionClarity: number;
  /** 進行の効率 1..5 */
  efficiency: number;
  /** 目的の達成度 1..5 */
  goalAchievement: number;
}

export interface ImprovementItem {
  point: string;
  category: ImprovementCategory;
}

/** CLI から --json-schema で受け取る分析結果本体 */
export interface AnalysisResult {
  summary: string;
  goodPoints: string[];
  improvements: ImprovementItem[];
  scores: AnalysisScores;
}

/** analysisDir に保存する形式（メタデータ付き） */
export interface StoredAnalysis {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  analyzedAt: string;
  model: AnalysisModel;
  /** 分析時点のセッションファイル stat（鮮度判定用） */
  sourceMtimeMs: number;
  sourceSize: number;
  /** セッション最終活動時刻（週次トレンド用） */
  sessionLastAt: string;
  costUSD: number | null;
  result: AnalysisResult;
}

type AnyRecord = Record<string, unknown>;

const isObject = (v: unknown): v is AnyRecord =>
  typeof v === "object" && v !== null;

const isScore = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;

const isNonEmptyStringArray = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= max &&
  v.every((s) => typeof s === "string" && s.length > 0);

function isImprovementItem(v: unknown): v is ImprovementItem {
  return (
    isObject(v) &&
    typeof v.point === "string" &&
    v.point.length > 0 &&
    IMPROVEMENT_CATEGORIES.includes(v.category as ImprovementCategory)
  );
}

export function isAnalysisResult(v: unknown): v is AnalysisResult {
  if (!isObject(v)) return false;
  if (typeof v.summary !== "string" || v.summary.length === 0) return false;
  if (!isNonEmptyStringArray(v.goodPoints, 5)) return false;
  const imp = v.improvements;
  if (!Array.isArray(imp) || imp.length < 1 || imp.length > 5) return false;
  if (!imp.every(isImprovementItem)) return false;
  const scores = v.scores;
  if (!isObject(scores)) return false;
  return (
    isScore(scores.instructionClarity) &&
    isScore(scores.efficiency) &&
    isScore(scores.goalAchievement)
  );
}

export function isStoredAnalysis(v: unknown): v is StoredAnalysis {
  if (!isObject(v)) return false;
  if (v.schemaVersion !== 1) return false;
  if (typeof v.sessionId !== "string") return false;
  if (typeof v.projectId !== "string") return false;
  if (typeof v.analyzedAt !== "string") return false;
  if (!ANALYSIS_MODEL_OPTIONS.includes(v.model as AnalysisModel)) return false;
  if (typeof v.sourceMtimeMs !== "number") return false;
  if (typeof v.sourceSize !== "number") return false;
  if (typeof v.sessionLastAt !== "string") return false;
  if (v.costUSD !== null && typeof v.costUSD !== "number") return false;
  return isAnalysisResult(v.result);
}

/** claude -p --json-schema に渡すスキーマ（AnalysisResult と対応） */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "goodPoints", "improvements", "scores"],
  properties: {
    summary: {
      type: "string",
      maxLength: 400,
      description: "セッション全体の振り返り要約（日本語、2〜3文）",
    },
    goodPoints: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", maxLength: 200 },
      description: "ユーザーの指示・進め方の良かった点",
    },
    improvements: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "category"],
        properties: {
          point: { type: "string", maxLength: 200 },
          category: { type: "string", enum: [...IMPROVEMENT_CATEGORIES] },
        },
      },
      description: "次回のセッションをより良くするための改善点",
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["instructionClarity", "efficiency", "goalAchievement"],
      properties: {
        instructionClarity: { type: "integer", minimum: 1, maximum: 5 },
        efficiency: { type: "integer", minimum: 1, maximum: 5 },
        goalAchievement: { type: "integer", minimum: 1, maximum: 5 },
      },
    },
  },
} as const;
