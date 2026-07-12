import type { SessionBuildOverrides } from "@/lib/domain/session-builder";
import type {
  AiTitleRecord,
  AssistantRecord,
  NormalizedRecord,
  RawContentBlock,
  UserRecord,
} from "@/lib/types";

export interface GeminiParseResult {
  records: NormalizedRecord[];
  skippedLines: number;
  overrides: SessionBuildOverrides;
  /** メタデータ行（または ConversationRecord）の sessionId */
  sessionId: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** PartListUnion（string | Part[] | Part）を正規化 text ブロックへ */
const toTextBlocks = (content: unknown): RawContentBlock[] => {
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  const parts = Array.isArray(content) ? content : [content];
  const blocks: RawContentBlock[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      if (p !== "") blocks.push({ type: "text", text: p });
      continue;
    }
    if (isObject(p)) {
      const text = str(p.text);
      if (text !== undefined) blocks.push({ type: "text", text });
    }
  }
  return blocks;
};

/**
 * Gemini CLI のチャット記録（~/.gemini/tmp/<hash>/chats/session-*.jsonl）を
 * 正規化レコードへ変換する。
 * - JSONL（1行目メタデータ + MessageRecord / $set / $rewindTo 行）と、
 *   旧形式の単一 JSON（ConversationRecord 全体）の両方を受け付ける
 * - user メッセージごとにターン（promptId なし = 常に新ターン）
 * - tokens: input は cached を除外、thoughts は output に合算
 * - $rewindTo は対象メッセージより後を破棄する
 */
export function parseGeminiChat(content: string): GeminiParseResult {
  const records: NormalizedRecord[] = [];
  const overrides: SessionBuildOverrides = {};
  let sessionId: string | null = null;
  let skippedLines = 0;
  /** $rewindTo 用: メッセージ id → その直前の records 長 */
  const recordStartByMessageId = new Map<string, number>();
  /** メッセージ id → そのメッセージ処理後の records 長（巻き戻し先端） */
  const recordEndByMessageId = new Map<string, number>();

  const handleMeta = (obj: Record<string, unknown>): void => {
    sessionId = str(obj.sessionId) ?? sessionId;
    if (Array.isArray(obj.directories)) {
      const first = str(obj.directories[0]);
      if (first !== undefined) overrides.projectPath = first;
    }
    const summary = str(obj.summary);
    if (summary !== undefined) {
      const rec: AiTitleRecord = { type: "ai-title", aiTitle: summary };
      records.push(rec);
    }
  };

  const handleMessage = (obj: Record<string, unknown>): void => {
    const id = str(obj.id) ?? `gemini-${records.length}`;
    const timestamp = str(obj.timestamp) ?? "";
    recordStartByMessageId.set(id, records.length);

    if (obj.type === "user") {
      const rec: UserRecord = {
        type: "user",
        uuid: `${id}-u`,
        parentUuid: null,
        timestamp,
        message: { role: "user", content: toTextBlocks(obj.content) },
      };
      records.push(rec);
    } else if (obj.type === "gemini") {
      const blocks: RawContentBlock[] = toTextBlocks(obj.content);
      const toolCalls = Array.isArray(obj.toolCalls) ? obj.toolCalls : [];
      const results: RawContentBlock[] = [];
      for (const [i, tc] of toolCalls.entries()) {
        if (!isObject(tc)) continue;
        const callId = str(tc.id) ?? `${id}-tool-${i}`;
        blocks.push({
          type: "tool_use",
          id: callId,
          name: str(tc.name) ?? "unknown",
          input: tc.args,
        });
        const status = str(tc.status)?.toLowerCase() ?? "";
        results.push({
          type: "tool_result",
          tool_use_id: callId,
          is_error: status.includes("error") || status.includes("fail"),
          content: tc.result,
        });
      }

      const tokens = isObject(obj.tokens) ? obj.tokens : {};
      const input = num(tokens.input);
      const cached = num(tokens.cached);
      const rec: AssistantRecord = {
        type: "assistant",
        uuid: `${id}-a`,
        parentUuid: null,
        timestamp,
        requestId: id,
        message: {
          model: str(obj.model),
          content: blocks,
          usage: {
            input_tokens: Math.max(0, input - cached),
            output_tokens: num(tokens.output) + num(tokens.thoughts),
            cache_read_input_tokens: cached,
          },
        },
      };
      records.push(rec);

      if (results.length > 0) {
        const resultRec: UserRecord = {
          type: "user",
          uuid: `${id}-r`,
          parentUuid: null,
          timestamp,
          message: { role: "user", content: results },
        };
        records.push(resultRec);
      }
    }
    // info / error / warning 等の非会話メッセージは無視
    recordEndByMessageId.set(id, records.length);
  };

  const handleRecord = (obj: Record<string, unknown>): void => {
    if (typeof obj.type === "string" && (obj.type === "user" || obj.type === "gemini")) {
      handleMessage(obj);
      return;
    }
    if (isObject(obj.$set)) {
      handleMeta(obj.$set);
      return;
    }
    const rewindTo = str(obj.$rewindTo);
    if (rewindTo !== undefined) {
      const end = recordEndByMessageId.get(rewindTo);
      if (end !== undefined && end < records.length) records.length = end;
      return;
    }
    if (str(obj.sessionId) !== undefined && obj.type === undefined) {
      handleMeta(obj); // 先頭メタデータ行
      return;
    }
    // 未知レコードは無視（寛容設計）
  };

  const trimmedAll = content.trim();
  if (trimmedAll === "") {
    return { records, skippedLines, overrides, sessionId };
  }

  // 旧形式: ファイル全体が1つの ConversationRecord（整形済み含む）
  if (trimmedAll.startsWith("{")) {
    try {
      const whole: unknown = JSON.parse(trimmedAll);
      if (isObject(whole) && Array.isArray(whole.messages)) {
        handleMeta(whole);
        for (const m of whole.messages) {
          if (isObject(m)) handleMessage(m);
        }
        return { records, skippedLines, overrides, sessionId };
      }
    } catch {
      // JSONL として処理する
    }
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skippedLines += 1;
      continue;
    }
    if (!isObject(obj)) {
      skippedLines += 1;
      continue;
    }
    handleRecord(obj);
  }

  return { records, skippedLines, overrides, sessionId };
}
