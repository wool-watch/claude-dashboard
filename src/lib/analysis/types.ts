import { isSessionMetrics, type SessionMetrics } from "@/lib/analysis/metrics";
import type { ProviderId } from "@/lib/settings/settings";
import { PROVIDER_IDS } from "@/lib/settings/settings";

/** 改善点カテゴリ: 手戻り・非効率の主因ベース（行動に直結する分類） */
export const IMPROVEMENT_CATEGORIES = [
  "計画不足",
  "指示不足",
  "コンテキスト不足",
  "仕様・方針変更",
  "検証不足",
  "スコープ超過",
  "エージェント誤りへの対処",
  "ツール・環境活用",
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

/** ハーネスエンジニアリングの実践5軸（各 1..5） */
export interface AnalysisScores {
  /** 計画・タスク分解: 着手前に計画・完了条件・機能分解があったか */
  planning: number;
  /** コンテキスト提供・管理: 背景・制約・成功基準の事前共有 */
  contextProvision: number;
  /** 検証・テスト実践: 実装をテスト・動作確認で裏付けたか */
  verification: number;
  /** 軌道安定性: 割り込み・やり直し・軌道修正の少なさ */
  trajectoryStability: number;
  /** スコープ規律: 対象範囲が明確で膨張しなかったか */
  scopeDiscipline: number;
}

export const SCORE_KEYS = [
  "planning",
  "contextProvision",
  "verification",
  "trajectoryStability",
  "scopeDiscipline",
] as const;

export interface ImprovementItem {
  /** 次のセッションでそのまま実行できる一文 */
  action: string;
  category: ImprovementCategory;
}

/** CLI から --json-schema で受け取る分析結果本体 */
export interface AnalysisResult {
  summary: string;
  goodPoints: string[];
  improvements: ImprovementItem[];
  scores: AnalysisScores;
}

/** analysisDir に保存する形式（メタデータ + 決定論的メトリクス付き） */
export interface StoredAnalysis {
  schemaVersion: 2;
  sessionId: string;
  projectId: string;
  analyzedAt: string;
  /** 分析に使ったモデル名（プロバイダごとに自由形式） */
  model: string;
  /** 分析に使ったプロバイダ（欠損 = claude） */
  provider?: ProviderId;
  /** 分析時点のセッションファイル stat（鮮度判定用） */
  sourceMtimeMs: number;
  sourceSize: number;
  /** セッション最終活動時刻（週次トレンド用） */
  sessionLastAt: string;
  costUSD: number | null;
  /** JSONL から決定論的に算出した定量メトリクス */
  metrics: SessionMetrics;
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
    typeof v.action === "string" &&
    v.action.length > 0 &&
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
  return SCORE_KEYS.every((key) => isScore(scores[key]));
}

export function isStoredAnalysis(v: unknown): v is StoredAnalysis {
  if (!isObject(v)) return false;
  if (v.schemaVersion !== 2) return false;
  if (typeof v.sessionId !== "string") return false;
  if (typeof v.projectId !== "string") return false;
  if (typeof v.analyzedAt !== "string") return false;
  if (typeof v.model !== "string" || v.model === "") return false;
  if (v.provider !== undefined && !PROVIDER_IDS.includes(v.provider as ProviderId)) {
    return false;
  }
  if (typeof v.sourceMtimeMs !== "number") return false;
  if (typeof v.sourceSize !== "number") return false;
  if (typeof v.sessionLastAt !== "string") return false;
  if (v.costUSD !== null && typeof v.costUSD !== "number") return false;
  if (!isSessionMetrics(v.metrics)) return false;
  return isAnalysisResult(v.result);
}

/**
 * 旧 v1 保存ファイルの最小判定。
 * 「stale（要再分析）」として一覧に出し、一括再分析導線に乗せるために使う。
 */
export function isLegacyStoredAnalysis(
  v: unknown,
): v is { sessionId: string; projectId: string } {
  return (
    isObject(v) &&
    v.schemaVersion === 1 &&
    typeof v.sessionId === "string" &&
    typeof v.projectId === "string"
  );
}

/**
 * claude -p --json-schema に渡すスキーマ（AnalysisResult と対応）。
 * 注意: openai-compat の strict モード（additionalProperties:false + 全 required）と
 * Gemini のプロンプト埋め込みの制約があるため、ネスト1段・enum・整数の複雑度を維持し、
 * metrics はこのスキーマに含めない（プロンプト入力側にのみ渡す）。
 */
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
      description: "ユーザーの指示・進め方の良かった点（記録中の根拠つき）",
    },
    improvements: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "category"],
        properties: {
          action: {
            type: "string",
            maxLength: 200,
            description: "次のセッションでそのまま実行できる具体的な一文",
          },
          category: { type: "string", enum: [...IMPROVEMENT_CATEGORIES] },
        },
      },
      description: "品質・工数・コストを改善するための具体アクション",
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "planning",
        "contextProvision",
        "verification",
        "trajectoryStability",
        "scopeDiscipline",
      ],
      properties: {
        planning: { type: "integer", minimum: 1, maximum: 5 },
        contextProvision: { type: "integer", minimum: 1, maximum: 5 },
        verification: { type: "integer", minimum: 1, maximum: 5 },
        trajectoryStability: { type: "integer", minimum: 1, maximum: 5 },
        scopeDiscipline: { type: "integer", minimum: 1, maximum: 5 },
      },
    },
  },
} as const;
