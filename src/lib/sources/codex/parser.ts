import type { SessionBuildOverrides } from "@/lib/domain/session-builder";
import type {
  AssistantRecord,
  NormalizedRecord,
  RawContentBlock,
  TurnDurationRecord,
  UserRecord,
} from "@/lib/types";

export interface CodexParseResult {
  records: NormalizedRecord[];
  skippedLines: number;
  overrides: SessionBuildOverrides;
}

interface TokenUsageInfo {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** AGENTS.md 注入・環境コンテキスト等、Codex が自動挿入する user メッセージの判定 */
const META_TEXT_RE =
  /^(#\s*AGENTS\.md instructions|<user_instructions>|<environment_context>|<permissions instructions>|<collaboration_mode>|<skills_instructions>|<apps_instructions>|<plugins)/;

const isMetaUserContent = (blocks: RawContentBlock[]): boolean =>
  blocks.length > 0 &&
  blocks.every((b) => META_TEXT_RE.test((b.text ?? "").trimStart()));

/** input_text / output_text ブロック配列を正規化 text ブロックへ */
const toTextBlocks = (content: unknown): RawContentBlock[] => {
  if (!Array.isArray(content)) return [];
  const blocks: RawContentBlock[] = [];
  for (const b of content) {
    if (!isObject(b)) continue;
    const text = str(b.text);
    if (text === undefined) continue;
    blocks.push({ type: "text", text });
  }
  return blocks;
};

/** function_call_output の output から exit_code ベースでエラー判定（best-effort） */
const isErrorOutput = (output: unknown): boolean => {
  let parsed: unknown = output;
  if (typeof output === "string") {
    try {
      parsed = JSON.parse(output);
    } catch {
      return false;
    }
  }
  if (!isObject(parsed)) return false;
  const metadata = parsed.metadata;
  if (!isObject(metadata)) return false;
  const exitCode = metadata.exit_code;
  return typeof exitCode === "number" && exitCode !== 0;
};

/**
 * Codex CLI のロールアウト JSONL（~/.codex/sessions/**）を正規化レコードへ変換する。
 * - turn_context.turn_id を promptId として採用（ターン分割キー）
 * - token_count（APIリクエスト単位）ごとに requestId を確定し、直前の
 *   assistant レコード群に付与。usage は最後のレコードに載せる
 *   （session-builder の「requestId ごとに最後の出現を採用」に合わせる）
 * - 未知タイプは無視、JSON 破損行のみ skippedLines に数える（寛容設計）
 */
export function parseCodexRollout(content: string): CodexParseResult {
  const records: NormalizedRecord[] = [];
  const overrides: SessionBuildOverrides = {};

  let skippedLines = 0;
  let lineNo = 0;
  let currentTurnId: string | null = null;
  let currentModel: string | undefined;
  let requestCount = 0;
  /** 現在のAPIリクエストに属する assistant レコード（token_count で確定） */
  let pendingAssistants: AssistantRecord[] = [];
  let prevTotal: TokenUsageInfo = {};

  const uid = (suffix: string): string => `codex-${lineNo}-${suffix}`;

  const pushAssistant = (
    timestamp: string,
    message: AssistantRecord["message"],
  ): AssistantRecord => {
    const rec: AssistantRecord = {
      type: "assistant",
      uuid: uid("a"),
      parentUuid: null,
      timestamp,
      message: { model: currentModel, ...message },
    };
    records.push(rec);
    pendingAssistants.push(rec);
    return rec;
  };

  const flushRequest = (timestamp: string, usage: TokenUsageInfo): void => {
    requestCount += 1;
    const requestId = `codex-req-${requestCount}`;
    const input = num(usage.input_tokens);
    const cached = num(usage.cached_input_tokens);
    const rawUsage = {
      input_tokens: Math.max(0, input - cached),
      output_tokens: num(usage.output_tokens),
      cache_read_input_tokens: cached,
    };
    if (pendingAssistants.length === 0) {
      // 出力レコードなしで usage だけ来た場合（中断直後等）は合成レコードで運ぶ
      pushAssistant(timestamp, { content: [] });
    }
    for (const rec of pendingAssistants) rec.requestId = requestId;
    pendingAssistants[pendingAssistants.length - 1].message.usage = rawUsage;
    pendingAssistants = [];
  };

  for (const line of content.split("\n")) {
    lineNo += 1;
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
    const timestamp = str(obj.timestamp) ?? "";
    const payload = isObject(obj.payload) ? obj.payload : {};

    switch (obj.type) {
      case "session_meta": {
        overrides.projectPath = str(payload.cwd) ?? overrides.projectPath;
        overrides.version = str(payload.cli_version) ?? overrides.version;
        if (isObject(payload.git)) {
          overrides.gitBranch = str(payload.git.branch) ?? overrides.gitBranch;
        }
        break;
      }
      case "turn_context": {
        currentTurnId = str(payload.turn_id) ?? currentTurnId;
        currentModel = str(payload.model) ?? currentModel;
        break;
      }
      case "response_item": {
        switch (payload.type) {
          case "message": {
            const blocks = toTextBlocks(payload.content);
            if (payload.role === "user") {
              const rec: UserRecord = {
                type: "user",
                uuid: uid("u"),
                parentUuid: null,
                timestamp,
                promptId: currentTurnId ?? undefined,
                isMeta: isMetaUserContent(blocks) || undefined,
                message: { role: "user", content: blocks },
              };
              records.push(rec);
            } else if (payload.role === "assistant") {
              pushAssistant(timestamp, {
                id: str(payload.id),
                content: blocks,
              });
            }
            // developer 等その他のロールは会話に含めない
            break;
          }
          case "custom_tool_call":
          case "function_call":
          case "local_shell_call": {
            const callId = str(payload.call_id) ?? uid("call");
            const name =
              str(payload.name) ??
              (payload.type === "local_shell_call" ? "shell" : String(payload.type));
            let input: unknown = payload.input ?? payload.action;
            if (payload.type === "function_call") {
              const args = str(payload.arguments);
              if (args !== undefined) {
                try {
                  input = JSON.parse(args);
                } catch {
                  input = args;
                }
              }
            }
            pushAssistant(timestamp, {
              id: str(payload.id),
              content: [{ type: "tool_use", id: callId, name, input }],
            });
            break;
          }
          case "custom_tool_call_output":
          case "function_call_output": {
            const callId = str(payload.call_id) ?? uid("result");
            const rec: UserRecord = {
              type: "user",
              uuid: uid("r"),
              parentUuid: null,
              timestamp,
              message: {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: callId,
                    is_error: isErrorOutput(payload.output),
                    content: payload.output,
                  },
                ],
              },
            };
            records.push(rec);
            break;
          }
          default:
            break; // reasoning 等は無視
        }
        break;
      }
      case "event_msg": {
        switch (payload.type) {
          case "task_started": {
            // turn_context より先に来るため、両方から turn_id を拾う
            currentTurnId = str(payload.turn_id) ?? currentTurnId;
            break;
          }
          case "token_count": {
            const info = isObject(payload.info) ? payload.info : {};
            const last = isObject(info.last_token_usage)
              ? (info.last_token_usage as TokenUsageInfo)
              : null;
            const total = isObject(info.total_token_usage)
              ? (info.total_token_usage as TokenUsageInfo)
              : null;
            let usage: TokenUsageInfo | null = last;
            if (usage === null && total !== null) {
              usage = {
                input_tokens: num(total.input_tokens) - num(prevTotal.input_tokens),
                cached_input_tokens:
                  num(total.cached_input_tokens) - num(prevTotal.cached_input_tokens),
                output_tokens:
                  num(total.output_tokens) - num(prevTotal.output_tokens),
              };
            }
            if (total !== null) prevTotal = total;
            if (usage !== null) flushRequest(timestamp, usage);
            break;
          }
          case "task_complete": {
            const durationMs = num(payload.duration_ms);
            if (durationMs > 0) {
              const rec: TurnDurationRecord = {
                type: "system",
                subtype: "turn_duration",
                durationMs,
                timestamp,
                parentUuid: null,
              };
              records.push(rec);
            }
            break;
          }
          case "turn_aborted": {
            const rec: UserRecord = {
              type: "user",
              uuid: uid("abort"),
              parentUuid: null,
              timestamp,
              promptId: currentTurnId ?? undefined,
              message: { role: "user", content: "[Request interrupted by user]" },
            };
            records.push(rec);
            break;
          }
          default:
            break; // user_message / agent_message は response_item と重複するため無視
        }
        break;
      }
      default:
        break; // world_state 等の未知タイプは無視
    }
  }

  return { records, skippedLines, overrides };
}
