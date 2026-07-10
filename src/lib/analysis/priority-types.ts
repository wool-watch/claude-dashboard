import type { ImprovementCategory } from "@/lib/analysis/types";
import { IMPROVEMENT_CATEGORIES } from "@/lib/analysis/types";

/**
 * 優先課題分析で選べるモデル。
 * セッション分析の AnalysisModel（設定に保存される）とは独立で、opus も許可する。
 */
export const PRIORITY_ANALYSIS_MODEL_OPTIONS = ["haiku", "sonnet", "opus"] as const;
export type PriorityAnalysisModel = (typeof PRIORITY_ANALYSIS_MODEL_OPTIONS)[number];

export function parsePriorityAnalysisModel(
  v: unknown,
): PriorityAnalysisModel | null {
  return PRIORITY_ANALYSIS_MODEL_OPTIONS.includes(v as PriorityAnalysisModel)
    ? (v as PriorityAnalysisModel)
    : null;
}

/** AIが選定した最優先課題1件 */
export interface PriorityIssue {
  point: string;
  category: ImprovementCategory;
  /** 最優先と判断した理由（頻度・影響度の観点） */
  reason: string;
  /** 次のセッションでそのまま実行できる具体的アクション 1..5件 */
  actions: string[];
}

/** CLI から --json-schema で受け取る優先課題分析の結果本体 */
export interface PriorityAnalysisResult {
  /** 1..3件 */
  pickedIssues: PriorityIssue[];
  /** 全体講評 2〜3文 */
  summary: string;
}

/** analysisDir/priority-analysis.json に保存する形式（1件のみ） */
export interface StoredPriorityAnalysis {
  schemaVersion: 1;
  analyzedAt: string;
  model: PriorityAnalysisModel;
  /** 入力に使った振り返り分析の件数 */
  analyzedSessionCount: number;
  costUSD: number | null;
  result: PriorityAnalysisResult;
}

type AnyRecord = Record<string, unknown>;

const isObject = (v: unknown): v is AnyRecord =>
  typeof v === "object" && v !== null;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

function isPriorityIssue(v: unknown): v is PriorityIssue {
  if (!isObject(v)) return false;
  if (!isNonEmptyString(v.point)) return false;
  if (!IMPROVEMENT_CATEGORIES.includes(v.category as ImprovementCategory)) {
    return false;
  }
  if (!isNonEmptyString(v.reason)) return false;
  const actions = v.actions;
  return (
    Array.isArray(actions) &&
    actions.length >= 1 &&
    actions.length <= 5 &&
    actions.every(isNonEmptyString)
  );
}

export function isPriorityAnalysisResult(
  v: unknown,
): v is PriorityAnalysisResult {
  if (!isObject(v)) return false;
  const issues = v.pickedIssues;
  if (!Array.isArray(issues) || issues.length < 1 || issues.length > 3) {
    return false;
  }
  if (!issues.every(isPriorityIssue)) return false;
  return isNonEmptyString(v.summary);
}

export function isStoredPriorityAnalysis(
  v: unknown,
): v is StoredPriorityAnalysis {
  if (!isObject(v)) return false;
  if (v.schemaVersion !== 1) return false;
  if (typeof v.analyzedAt !== "string") return false;
  if (parsePriorityAnalysisModel(v.model) === null) return false;
  if (typeof v.analyzedSessionCount !== "number") return false;
  if (v.costUSD !== null && typeof v.costUSD !== "number") return false;
  return isPriorityAnalysisResult(v.result);
}

/** claude -p --json-schema に渡すスキーマ（PriorityAnalysisResult と対応） */
export const PRIORITY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pickedIssues", "summary"],
  properties: {
    pickedIssues: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "category", "reason", "actions"],
        properties: {
          point: { type: "string", maxLength: 200 },
          category: { type: "string", enum: [...IMPROVEMENT_CATEGORIES] },
          reason: { type: "string", maxLength: 300 },
          actions: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", maxLength: 200 },
          },
        },
      },
      description: "最も優先して取り組むべき課題（1〜3件）",
    },
    summary: {
      type: "string",
      maxLength: 400,
      description: "全体講評（日本語、2〜3文）",
    },
  },
} as const;
