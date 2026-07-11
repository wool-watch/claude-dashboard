import type {
  PracticeId,
  PriorityActionKind,
} from "@/lib/analysis/practices";
import {
  PRACTICE_IDS,
  PRIORITY_ACTION_KINDS,
} from "@/lib/analysis/practices";
import type { ImprovementCategory } from "@/lib/analysis/types";
import { IMPROVEMENT_CATEGORIES } from "@/lib/analysis/types";
import type { ProviderId } from "@/lib/settings/settings";
import { PROVIDER_IDS } from "@/lib/settings/settings";

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

/** ベストプラクティスを根拠にした構造化アクション1件 */
export interface PriorityAction {
  /** 短い一文タイトル */
  title: string;
  /** 実施手段の種別 */
  kind: PriorityActionKind;
  /** 根拠にしたベストプラクティスカタログの id */
  practice: PracticeId;
  /** 具体的な実施手順 */
  how: string;
  /** 改善が見込める5軸・メトリクスと入力実数値を明示した期待効果 */
  expectedEffect: string;
  /** コピペしてそのまま使える完成文（CLAUDE.md 追記文・依頼テンプレ等）。不要なら空文字 */
  snippet: string;
}

/** AIが選定した最優先課題1件 */
export interface PriorityIssue {
  point: string;
  category: ImprovementCategory;
  /** 最優先と判断した理由（頻度・影響度の観点） */
  reason: string;
  /** ベストプラクティスを根拠にした構造化アクション 1..3件 */
  actions: PriorityAction[];
}

/** CLI から --json-schema で受け取る優先課題分析の結果本体 */
export interface PriorityAnalysisResult {
  /** 1..3件 */
  pickedIssues: PriorityIssue[];
  /** 全体講評 2〜3文 */
  summary: string;
}

/**
 * 優先課題分析の保存形式。
 * グローバルは analysisDir/priority-analysis.json、
 * プロジェクト別は analysisDir/priority-analysis.<projectId>.json に各1件。
 */
export interface StoredPriorityAnalysis {
  schemaVersion: 3;
  analyzedAt: string;
  /** 分析に使ったモデル名（プロバイダごとに自由形式） */
  model: string;
  /** 分析に使ったプロバイダ（欠損 = 旧データ = claude） */
  provider?: ProviderId;
  /** 対象プロジェクト（グローバル分析は undefined） */
  projectId?: string;
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

function isPriorityAction(v: unknown): v is PriorityAction {
  if (!isObject(v)) return false;
  if (!isNonEmptyString(v.title)) return false;
  if (!PRIORITY_ACTION_KINDS.includes(v.kind as PriorityActionKind)) {
    return false;
  }
  if (!PRACTICE_IDS.includes(v.practice as PracticeId)) return false;
  if (!isNonEmptyString(v.how)) return false;
  if (!isNonEmptyString(v.expectedEffect)) return false;
  // snippet は「不要」を空文字で表現するため空を許容する（欠損は不可）
  return typeof v.snippet === "string";
}

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
    actions.length <= 3 &&
    actions.every(isPriorityAction)
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
  if (v.schemaVersion !== 3) return false;
  if (typeof v.analyzedAt !== "string") return false;
  if (typeof v.model !== "string" || v.model === "") return false;
  if (v.provider !== undefined && !PROVIDER_IDS.includes(v.provider as ProviderId)) {
    return false;
  }
  if (v.projectId !== undefined && typeof v.projectId !== "string") return false;
  if (typeof v.analyzedSessionCount !== "number") return false;
  if (v.costUSD !== null && typeof v.costUSD !== "number") return false;
  return isPriorityAnalysisResult(v.result);
}

/**
 * 旧 v1/v2 保存ファイルの最小判定。
 * 「旧形式（要再分析）」として UI に案内を出すために使う。
 */
export function isLegacyStoredPriorityAnalysis(
  v: unknown,
): v is { schemaVersion: 1 | 2 } {
  return (
    isObject(v) &&
    (v.schemaVersion === 1 || v.schemaVersion === 2) &&
    typeof v.analyzedAt === "string"
  );
}

/**
 * claude -p --json-schema に渡すスキーマ（PriorityAnalysisResult と対応）。
 * 注意: actions のネスト2段は許容する（openai-compat は strict 拒否時に
 * プロンプト埋め込みへフォールバックする）。strict モード（全 required）対応のため
 * 全フィールドを required にし、snippet の省略は空文字で表現する。
 */
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
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "kind",
                "practice",
                "how",
                "expectedEffect",
                "snippet",
              ],
              properties: {
                title: {
                  type: "string",
                  maxLength: 100,
                  description: "アクションの短い一文タイトル",
                },
                kind: {
                  type: "string",
                  enum: [...PRIORITY_ACTION_KINDS],
                  description: "実施手段の種別",
                },
                practice: {
                  type: "string",
                  enum: [...PRACTICE_IDS],
                  description: "根拠にしたベストプラクティスカタログの id",
                },
                how: {
                  type: "string",
                  maxLength: 400,
                  description: "具体的な実施手順",
                },
                expectedEffect: {
                  type: "string",
                  maxLength: 300,
                  description:
                    "改善が見込める軸・メトリクス名と入力中の実数値を明示した期待効果",
                },
                snippet: {
                  type: "string",
                  maxLength: 800,
                  description:
                    "コピペしてそのまま使える完成文（CLAUDE.md 追記文・依頼テンプレ等）。不要なら空文字",
                },
              },
            },
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
