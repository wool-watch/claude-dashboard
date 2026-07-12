import type { DashboardConfig } from "@/lib/config";
import { estimateActiveTime } from "@/lib/domain/active-time";
import { isTurnTrigger } from "@/lib/domain/turns";
import {
  extractToolUses,
  extractUserText,
  isAiTitleRecord,
  isAssistantRecord,
  isTurnDurationRecord,
  isUserRecord,
  normalizeUsage,
} from "@/lib/parser/records";
import { calculateCost } from "@/lib/pricing/cost";
import { formatSessionKey } from "@/lib/sources/keys";
import type { SessionSourceId } from "@/lib/sources/types";
import {
  addUsage,
  type AssistantRecord,
  emptyUsage,
  type SessionDetail,
  type Turn,
  type UsageTotals,
  type UserRecord,
} from "@/lib/types";

interface TurnDraft {
  promptId: string | null;
  userText: string;
  records: Array<UserRecord | AssistantRecord>;
  reportedDurationMs?: number;
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max)}…`;

/** models 一覧に載せない内部モデルID */
const HIDDEN_MODELS = new Set(["<synthetic>", "<unknown>"]);

/**
 * 1ファイル分のレコード列を SessionDetail に構造化する。
 * sessionId はレコード内の値でなくファイル名を正とする（再開時に不一致があるため）。
 */
/** ソース固有メタ（Codex session_meta 等）による確定値。レコード由来の推定より優先 */
export interface SessionBuildOverrides {
  projectPath?: string;
  version?: string;
  gitBranch?: string;
}

export interface SessionBuildOptions {
  source?: SessionSourceId;
  overrides?: SessionBuildOverrides;
}

export function buildSession(
  records: unknown[],
  sessionId: string,
  projectId: string,
  skippedLines: number,
  config: DashboardConfig,
  options?: SessionBuildOptions,
): SessionDetail {
  const source = options?.source ?? "claude";
  const overrides = options?.overrides;
  // ---- パス1: メタ収集 ----
  const cwdCounts = new Map<string, number>();
  let version: string | null = null;
  let gitBranch: string | null = null;
  let aiTitle: string | null = null;

  for (const r of records) {
    if (isAiTitleRecord(r)) {
      aiTitle = r.aiTitle;
      continue;
    }
    if (isUserRecord(r) || isAssistantRecord(r)) {
      if (typeof r.cwd === "string" && r.cwd !== "") {
        cwdCounts.set(r.cwd, (cwdCounts.get(r.cwd) ?? 0) + 1);
      }
      if (typeof r.version === "string" && r.version !== "") version = r.version;
      if (typeof r.gitBranch === "string" && r.gitBranch !== "")
        gitBranch = r.gitBranch;
    }
  }

  let projectPath = projectId;
  let bestCount = 0;
  for (const [cwd, count] of cwdCounts) {
    if (count > bestCount) {
      bestCount = count;
      projectPath = cwd;
    }
  }

  // ---- パス2: ターン分割（ファイル出現順） ----
  const drafts: TurnDraft[] = [];
  let current: TurnDraft | null = null;
  let messageCount = 0;
  let sidechainMessageCount = 0;
  let firstAt = "";
  let lastAt = "";
  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;
  const allTimestamps: Date[] = [];

  const note = (r: UserRecord | AssistantRecord): void => {
    if (r.isMeta !== true) {
      if (r.isSidechain === true) sidechainMessageCount++;
      else messageCount++;
    }
    const d = new Date(r.timestamp);
    const ms = d.getTime();
    if (Number.isFinite(ms)) {
      allTimestamps.push(d);
      if (ms < firstMs) {
        firstMs = ms;
        firstAt = r.timestamp;
      }
      if (ms > lastMs) {
        lastMs = ms;
        lastAt = r.timestamp;
      }
    }
  };

  for (const r of records) {
    if (isUserRecord(r)) {
      note(r);
      if (r.isMeta === true) continue;
      if (isTurnTrigger(r)) {
        const promptId = typeof r.promptId === "string" ? r.promptId : null;
        if (current !== null && promptId !== null && current.promptId === promptId) {
          // 同一 promptId の再出現は新ターンにしない
          current.records.push(r);
        } else {
          current = {
            promptId,
            userText: truncate(
              extractUserText(r.message.content),
              config.userTextMaxLength,
            ),
            records: [r],
          };
          drafts.push(current);
        }
      } else if (current !== null) {
        // tool_result・メタタグ・sidechain user は現行ターンに帰属
        current.records.push(r);
      }
      // 現行ターンがない非トリガー user はターンに帰属させない（カウントのみ）
    } else if (isAssistantRecord(r)) {
      note(r);
      if (r.isMeta === true) continue;
      if (current === null) {
        // 先頭 user より前の assistant（セッション再開ファイル等）は暗黙ターンへ
        current = { promptId: null, userText: "(セッション再開)", records: [] };
        drafts.push(current);
      }
      current.records.push(r);
    } else if (isTurnDurationRecord(r)) {
      if (current !== null) current.reportedDurationMs = r.durationMs;
    }
    // それ以外のレコードタイプは無視（寛容設計）
  }

  // ---- パス3: ターン内集計 ----
  const turns: Turn[] = drafts.map((d) => buildTurn(d, config));

  let usage = emptyUsage();
  let costUSD = 0;
  let costIsEstimated = false;
  const models: string[] = [];
  for (const t of turns) {
    usage = addUsage(usage, t.usage);
    costUSD += t.costUSD;
    costIsEstimated = costIsEstimated || t.costIsEstimated;
    for (const m of t.models) if (!models.includes(m)) models.push(m);
  }

  let title = aiTitle !== null ? truncate(aiTitle, config.titleMaxLength) : null;
  if (title === null && turns.length > 0 && turns[0].userText !== "") {
    title = truncate(turns[0].userText.split("\n")[0], config.titleMaxLength);
  }

  return {
    sessionId,
    sessionKey: formatSessionKey(source, sessionId),
    source,
    projectId,
    projectPath: overrides?.projectPath ?? projectPath,
    title,
    firstAt,
    lastAt,
    turnCount: turns.length,
    messageCount,
    sidechainMessageCount,
    models,
    usage,
    costUSD,
    costIsEstimated,
    activeTimeMs: estimateActiveTime(allTimestamps, config.idleThresholdMs),
    version: overrides?.version ?? version,
    gitBranch: overrides?.gitBranch ?? gitBranch,
    turns,
    skippedLines,
  };
}

function buildTurn(d: TurnDraft, config: DashboardConfig): Turn {
  // usage 計上は requestId（→ message.id → uuid）でデデュープし、最後の出現を採用
  const uniqueRequests = new Map<string, AssistantRecord>();
  const toolUses = new Map<string, string>();
  let hasSidechain = false;

  for (const rec of d.records) {
    if (rec.isSidechain === true) hasSidechain = true;
    if (rec.type !== "assistant") continue;
    const key = rec.requestId ?? rec.message.id ?? rec.uuid;
    uniqueRequests.set(key, rec);
    for (const t of extractToolUses(rec.message.content)) {
      toolUses.set(t.id, t.name);
    }
  }

  const perModelUsage: Record<string, UsageTotals> = {};
  const perModelRequests: Record<string, number> = {};
  for (const a of uniqueRequests.values()) {
    const model = a.message.model ?? "<unknown>";
    perModelUsage[model] = addUsage(
      perModelUsage[model] ?? emptyUsage(),
      normalizeUsage(a.message.usage),
    );
    perModelRequests[model] = (perModelRequests[model] ?? 0) + 1;
  }

  let usage = emptyUsage();
  let costUSD = 0;
  let costIsEstimated = false;
  for (const [model, u] of Object.entries(perModelUsage)) {
    usage = addUsage(usage, u);
    const c = calculateCost(u, model);
    costUSD += c.costUSD;
    costIsEstimated = costIsEstimated || c.isEstimated;
  }

  const toolCounts: Record<string, number> = {};
  for (const name of toolUses.values()) {
    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
  }

  const startedAt = d.records[0]?.timestamp ?? "";
  const startMs = new Date(startedAt).getTime();
  let endedAt = startedAt;
  let endMs = startMs;
  for (const rec of d.records) {
    const ms = new Date(rec.timestamp).getTime();
    if (Number.isFinite(ms) && (!Number.isFinite(endMs) || ms >= endMs)) {
      endMs = ms;
      endedAt = rec.timestamp;
    }
  }
  const fallbackDuration =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, endMs - startMs)
      : 0;

  return {
    promptId: d.promptId,
    userText: d.userText,
    startedAt,
    endedAt,
    durationMs: d.reportedDurationMs ?? fallbackDuration,
    activeTimeMs: estimateActiveTime(
      d.records.map((r) => new Date(r.timestamp)),
      config.idleThresholdMs,
    ),
    models: Object.keys(perModelUsage).filter((m) => !HIDDEN_MODELS.has(m)),
    perModelUsage,
    perModelRequests,
    toolCounts,
    usage,
    costUSD,
    costIsEstimated,
    assistantMessageCount: uniqueRequests.size,
    hasSidechain,
  };
}
