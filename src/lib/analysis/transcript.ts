import type { DashboardConfig } from "@/lib/config";
import { isTurnTrigger } from "@/lib/domain/turns";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import {
  extractAssistantText,
  extractToolUses,
  extractUserText,
  isAssistantRecord,
  isUserRecord,
} from "@/lib/parser/records";

export interface TranscriptResult {
  text: string;
  /** 本線のユーザー発話数。0 なら分析対象なし */
  userTurnCount: number;
  truncated: boolean;
}

interface Entry {
  role: "user" | "assistant";
  text: string;
  tools: string[];
}

const OMIT_MARKER = "…（省略）";

function capMessage(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + OMIT_MARKER;
}

function renderEntry(e: Entry, maxCharsPerMessage: number): string {
  const label = e.role === "user" ? "[USER]" : "[ASSISTANT]";
  const body = capMessage(e.text, maxCharsPerMessage);
  const tools = e.tools.length > 0 ? `(使用ツール: ${e.tools.join(", ")})` : "";
  const parts = [body, tools].filter((s) => s !== "");
  return `${label} ${parts.join(" ")}`;
}

/** 全体上限超過時は先頭60%・末尾40%を残して中間を切除する */
function capTotal(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const omitted = text.length - maxChars;
  const marker = `\n…（中略: 約${omitted}文字省略）…\n`;
  const budget = Math.max(maxChars - marker.length, 0);
  const headLen = Math.floor(budget * 0.6);
  const tailLen = budget - headLen;
  return {
    text: text.slice(0, headLen) + marker + text.slice(text.length - tailLen),
    truncated: true,
  };
}

/**
 * 生JSONLから分析用の平文トランスクリプトを構築する。
 * サイドチェーン・メタ行・tool_result のみの行は除外し、
 * 同一リクエスト（requestId ?? message.id ?? uuid）の assistant レコードは1エントリにマージする。
 */
export function buildTranscript(
  rawJsonl: string,
  config: DashboardConfig,
): TranscriptResult {
  const { records } = parseJsonlLines(rawJsonl);
  const entries: Entry[] = [];
  // 同一リクエストの assistant レコードをマージするためのエントリ参照
  const assistantByKey = new Map<string, Entry>();
  let userTurnCount = 0;

  for (const r of records) {
    if (isUserRecord(r)) {
      if (!isTurnTrigger(r)) continue;
      const text = extractUserText(r.message.content);
      if (text === "") continue;
      entries.push({ role: "user", text, tools: [] });
      userTurnCount += 1;
      continue;
    }
    if (isAssistantRecord(r)) {
      if (r.isSidechain === true) continue;
      const text = extractAssistantText(r.message.content);
      const tools = extractToolUses(r.message.content).map((t) => t.name);
      if (text === "" && tools.length === 0) continue;
      const key = r.requestId ?? r.message.id ?? r.uuid ?? null;
      const existing = key !== null ? assistantByKey.get(key) : undefined;
      if (existing !== undefined) {
        if (text !== "") {
          existing.text = existing.text === "" ? text : `${existing.text}\n${text}`;
        }
        for (const name of tools) {
          if (!existing.tools.includes(name)) existing.tools.push(name);
        }
        continue;
      }
      const entry: Entry = { role: "assistant", text, tools };
      entries.push(entry);
      if (key !== null) assistantByKey.set(key, entry);
    }
  }

  const rendered = entries
    .map((e) => renderEntry(e, config.transcriptMaxCharsPerMessage))
    .join("\n\n");
  const { text, truncated } = capTotal(rendered, config.transcriptMaxChars);
  return { text, userTurnCount, truncated };
}
