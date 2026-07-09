import type {
  AiTitleRecord,
  AssistantRecord,
  RawContentBlock,
  RawUsage,
  TurnDurationRecord,
  UsageTotals,
  UserRecord,
} from "@/lib/types";

type AnyRecord = Record<string, unknown>;

function isObject(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null;
}

export function isUserRecord(r: unknown): r is UserRecord {
  if (!isObject(r) || r.type !== "user") return false;
  if (typeof r.timestamp !== "string") return false;
  const msg = r.message;
  if (!isObject(msg) || msg.role !== "user") return false;
  return typeof msg.content === "string" || Array.isArray(msg.content);
}

export function isAssistantRecord(r: unknown): r is AssistantRecord {
  if (!isObject(r) || r.type !== "assistant") return false;
  if (typeof r.timestamp !== "string") return false;
  return isObject(r.message);
}

export function isAiTitleRecord(r: unknown): r is AiTitleRecord {
  if (!isObject(r) || r.type !== "ai-title") return false;
  return typeof r.aiTitle === "string" && r.aiTitle.length > 0;
}

export function isTurnDurationRecord(r: unknown): r is TurnDurationRecord {
  if (!isObject(r) || r.type !== "system" || r.subtype !== "turn_duration")
    return false;
  return typeof r.durationMs === "number" && Number.isFinite(r.durationMs);
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * usage の正規化。cache_creation の 5m/1h 分割があれば採用し、
 * なければ cache_creation_input_tokens 全量を 5m 書込としてフォールバックする。
 */
export function normalizeUsage(raw: RawUsage | undefined): UsageTotals {
  const cc = raw?.cache_creation;
  return {
    inputTokens: num(raw?.input_tokens),
    outputTokens: num(raw?.output_tokens),
    cacheWrite5mTokens: cc
      ? num(cc.ephemeral_5m_input_tokens)
      : num(raw?.cache_creation_input_tokens),
    cacheWrite1hTokens: cc ? num(cc.ephemeral_1h_input_tokens) : 0,
    cacheReadTokens: num(raw?.cache_read_input_tokens),
  };
}

export function extractToolUses(
  content: RawContentBlock[] | undefined,
): Array<{ id: string; name: string }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (b) =>
        b.type === "tool_use" &&
        typeof b.id === "string" &&
        typeof b.name === "string",
    )
    .map((b) => ({ id: b.id as string, name: b.name as string }));
}

/** user メッセージの表示用テキスト。配列のときは text ブロックを改行で連結 */
export function extractUserText(
  content: string | RawContentBlock[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** 全ブロックが tool_result のとき true（空配列も防御的に true = 非ターン扱い） */
export function isToolResultOnly(
  content: string | RawContentBlock[],
): boolean {
  if (typeof content === "string") return false;
  return content.every((b) => b.type === "tool_result");
}
