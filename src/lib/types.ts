import type { SessionAnalysisStatus } from "@/lib/analysis/types";
import type { SessionSourceId } from "@/lib/sources/types";

// ============ 生レコード（型ガード通過後） ============

/** message.usage の生形状（すべて省略されうる） */
export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface RawContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  /** tool_use ブロックのツール入力 */
  input?: unknown;
  /** tool_result ブロックの対応 tool_use id */
  tool_use_id?: string;
  /** tool_result ブロックのエラーフラグ（省略 = 成功） */
  is_error?: boolean;
  /** tool_result ブロックの結果本体（文字列またはブロック配列） */
  content?: unknown;
}

/** user / assistant 共通のエンベロープ項目 */
export interface RecordEnvelope {
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  /** ★信用しない（ファイル名を正とする） */
  sessionId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  /** true なら集計対象外（D-3） */
  isMeta?: boolean;
}

export interface UserRecord extends RecordEnvelope {
  type: "user";
  promptId?: string;
  message: { role: "user"; content: string | RawContentBlock[] };
}

export interface AssistantRecord extends RecordEnvelope {
  type: "assistant";
  requestId?: string;
  message: {
    model?: string;
    id?: string;
    content?: RawContentBlock[];
    usage?: RawUsage;
  };
}

export interface AiTitleRecord {
  type: "ai-title";
  aiTitle: string;
}

/** system/turn_duration レコード（D-1: ターン所要時間の一次情報） */
export interface TurnDurationRecord {
  type: "system";
  subtype: "turn_duration";
  durationMs: number;
  timestamp: string;
  parentUuid: string | null;
}

export type KnownRecord =
  | UserRecord
  | AssistantRecord
  | AiTitleRecord
  | TurnDurationRecord;

/**
 * ソース中立の正規化レコード（内部IR）。
 * Codex / Gemini の各アダプタは生形式をこの union へ正規化してから
 * session-builder / metrics / transcript に渡す。永続化はしない。
 */
export type NormalizedRecord = KnownRecord;

// ============ 正規化済みドメイン型 ============

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

export interface Turn {
  promptId: string | null;
  /** 最大200字（超過時は末尾 "…"） */
  userText: string;
  startedAt: string;
  endedAt: string;
  /** turn_duration レコード優先、なければ endedAt - startedAt */
  durationMs: number;
  /** ターン内レコード timestamp のギャップベース推定（D-4） */
  activeTimeMs: number;
  /** 出現順ユニーク。"<synthetic>" は含めない */
  models: string[];
  perModelUsage: Record<string, UsageTotals>;
  /** デデュープ後のモデル別リクエスト数 */
  perModelRequests: Record<string, number>;
  /** tool_use.id ユニーク化後のツール名別回数 */
  toolCounts: Record<string, number>;
  usage: UsageTotals;
  costUSD: number;
  costIsEstimated: boolean;
  /** デデュープ後のユニークリクエスト数 */
  assistantMessageCount: number;
  hasSidechain: boolean;
}

export interface SessionSummary {
  /** ファイル名（拡張子除く）を正とする */
  sessionId: string;
  /** ソース横断で一意なキー（claude は sessionId と同一、他は "<source>:<id>"） */
  sessionKey: string;
  /** セッションの取得元CLI */
  source: SessionSourceId;
  /** エンコード済ディレクトリ名 */
  projectId: string;
  /** 最頻 cwd。全欠落時は projectId をそのまま */
  projectPath: string;
  title: string | null;
  firstAt: string;
  lastAt: string;
  turnCount: number;
  /** isSidechain=false の user+assistant 行数（isMeta 除く、デデュープなし） */
  messageCount: number;
  sidechainMessageCount: number;
  models: string[];
  usage: UsageTotals;
  costUSD: number;
  costIsEstimated: boolean;
  activeTimeMs: number;
  version: string | null;
  gitBranch: string | null;
}

export interface SessionDetail extends SessionSummary {
  turns: Turn[];
  /** パース不能行数（デバッグ表示用） */
  skippedLines: number;
}

/** GET /api/sessions の1行分（分析ステータス付き） */
export interface SessionListItem extends SessionSummary {
  analysisStatus: SessionAnalysisStatus;
}

// ============ 集計結果型（= APIレスポンス型） ============

export type Granularity = "hour" | "day" | "week" | "month";

export interface TimeBucket {
  /** ローカルTZの "yyyy-MM-dd'T'HH:mm" */
  bucketStart: string;
  usage: UsageTotals;
  costUSD: number;
  messageCount: number;
  turnCount: number;
  activeTimeMs: number;
  /** そのバケットにターンを持つユニークセッション数 */
  sessionCount: number;
}

export interface PeriodStats {
  costUSD: number;
  totalTokens: number;
  usage: UsageTotals;
  sessionCount: number;
  turnCount: number;
  activeTimeMs: number;
}

export interface ApiSummary {
  totals: PeriodStats;
  today: PeriodStats;
  thisWeek: PeriodStats;
  thisMonth: PeriodStats;
  costIsEstimated: boolean;
  generatedAt: string;
}

export interface ModelStats {
  model: string;
  usage: UsageTotals;
  costUSD: number;
  requestCount: number;
  isEstimated: boolean;
}

export interface ToolStats {
  tool: string;
  count: number;
}

export interface ProjectSummary {
  projectId: string;
  projectPath: string;
  /** projectPath の末尾セグメント */
  displayName: string;
  sessionCount: number;
  turnCount: number;
  usage: UsageTotals;
  costUSD: number;
  activeTimeMs: number;
  lastAt: string;
}

export interface ApiError {
  error: string;
}

// ============ UsageTotals ユーティリティ ============

export const emptyUsage = (): UsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
});

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export function totalTokens(u: UsageTotals): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheWrite5mTokens +
    u.cacheWrite1hTokens +
    u.cacheReadTokens
  );
}
