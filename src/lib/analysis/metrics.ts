import { parseJsonlLines } from "@/lib/parser/jsonl";
import {
  extractToolResults,
  extractToolUseDetails,
  extractUserText,
  isAssistantRecord,
  isUserRecord,
} from "@/lib/parser/records";
import { totalTokens, type SessionSummary } from "@/lib/types";

/**
 * セッション JSONL から決定論的に算出する定量メトリクス。
 * LLM を使わないため無料・再現性があり、全セッションに即時適用できる。
 * 編集・エラー系はサイドチェーン（サブエージェント）も成果として含む。isMeta は除外。
 */
export interface SessionMetrics {
  // 実装規模（tool_use id でデデュープ後）
  editedFileCount: number;
  editOpCount: number;
  /** ヒューリスティック: Edit=new_string 行数 / Write=content 全行数（大きめに出る） */
  estimatedLinesAdded: number;
  estimatedLinesRemoved: number;
  // 手戻りシグナル
  interruptionCount: number;
  reEditedFileCount: number;
  maxEditsPerFile: number;
  // 不具合シグナル
  toolResultCount: number;
  toolErrorCount: number;
  testRunCount: number;
  testFailCount: number;
  // 時間・コスト・トークン（SessionSummary から転記）
  durationMs: number;
  activeTimeMs: number;
  costUSD: number;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  sidechainMessageCount: number;
  turnCount: number;
}

/** Bash コマンドをテスト実行とみなす判定（不具合シグナル用） */
export const TEST_COMMAND_RE =
  /\b(?:vitest|jest|pytest|playwright test|go test|cargo test|(?:npm|pnpm|yarn)(?: run)? test)\b/;

const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

type AnyRecord = Record<string, unknown>;

const isObject = (v: unknown): v is AnyRecord =>
  typeof v === "object" && v !== null;

const lineCount = (s: unknown): number =>
  typeof s === "string" && s !== "" ? s.split("\n").length : 0;

interface EditOp {
  file: string;
  added: number;
  removed: number;
}

/** 編集系 tool_use の input から対象ファイルと推定行数を取り出す（未知の形は無視） */
function toEditOp(name: string, input: unknown): EditOp | null {
  if (!isObject(input)) return null;
  if (name === "Edit") {
    if (typeof input.file_path !== "string") return null;
    return {
      file: input.file_path,
      added: lineCount(input.new_string),
      removed: lineCount(input.old_string),
    };
  }
  if (name === "Write") {
    if (typeof input.file_path !== "string") return null;
    return { file: input.file_path, added: lineCount(input.content), removed: 0 };
  }
  if (name === "MultiEdit") {
    if (typeof input.file_path !== "string" || !Array.isArray(input.edits)) {
      return null;
    }
    let added = 0;
    let removed = 0;
    for (const e of input.edits) {
      if (!isObject(e)) continue;
      added += lineCount(e.new_string);
      removed += lineCount(e.old_string);
    }
    return { file: input.file_path, added, removed };
  }
  if (name === "NotebookEdit") {
    if (typeof input.notebook_path !== "string") return null;
    return {
      file: input.notebook_path,
      added: lineCount(input.new_source),
      removed: 0,
    };
  }
  return null;
}

const parseMs = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
};

export function computeSessionMetrics(
  rawJsonl: string,
  session: SessionSummary,
): SessionMetrics {
  const { records } = parseJsonlLines(rawJsonl);

  // ストリーミング重複（同一 requestId の再出力）対策: tool_use は block id、
  // tool_result は tool_use_id でユニーク化する
  const seenToolUseIds = new Set<string>();
  const editsPerFile = new Map<string, number>();
  const testToolUseIds = new Set<string>();
  const resultErrorById = new Map<string, boolean>();
  let editOpCount = 0;
  let estimatedLinesAdded = 0;
  let estimatedLinesRemoved = 0;
  let interruptionCount = 0;

  for (const rec of records) {
    if (isAssistantRecord(rec)) {
      if (rec.isMeta === true) continue;
      for (const tu of extractToolUseDetails(rec.message.content)) {
        if (seenToolUseIds.has(tu.id)) continue;
        seenToolUseIds.add(tu.id);
        if (
          tu.name === "Bash" &&
          isObject(tu.input) &&
          typeof tu.input.command === "string" &&
          TEST_COMMAND_RE.test(tu.input.command)
        ) {
          testToolUseIds.add(tu.id);
        }
        if (!EDIT_TOOL_NAMES.has(tu.name)) continue;
        const op = toEditOp(tu.name, tu.input);
        if (!op) continue;
        editOpCount += 1;
        estimatedLinesAdded += op.added;
        estimatedLinesRemoved += op.removed;
        editsPerFile.set(op.file, (editsPerFile.get(op.file) ?? 0) + 1);
      }
      continue;
    }
    if (!isUserRecord(rec) || rec.isMeta === true) continue;
    for (const tr of extractToolResults(rec.message.content)) {
      if (!resultErrorById.has(tr.toolUseId)) {
        resultErrorById.set(tr.toolUseId, tr.isError);
      }
    }
    if (
      rec.isSidechain !== true &&
      extractUserText(rec.message.content).startsWith("[Request interrupted")
    ) {
      interruptionCount += 1;
    }
  }

  let toolErrorCount = 0;
  for (const isError of resultErrorById.values()) {
    if (isError) toolErrorCount += 1;
  }
  let testFailCount = 0;
  for (const id of testToolUseIds) {
    if (resultErrorById.get(id) === true) testFailCount += 1;
  }
  let reEditedFileCount = 0;
  let maxEditsPerFile = 0;
  for (const count of editsPerFile.values()) {
    if (count >= 2) reEditedFileCount += 1;
    if (count > maxEditsPerFile) maxEditsPerFile = count;
  }

  const duration = parseMs(session.lastAt) - parseMs(session.firstAt);

  return {
    editedFileCount: editsPerFile.size,
    editOpCount,
    estimatedLinesAdded,
    estimatedLinesRemoved,
    interruptionCount,
    reEditedFileCount,
    maxEditsPerFile,
    toolResultCount: resultErrorById.size,
    toolErrorCount,
    testRunCount: testToolUseIds.size,
    testFailCount,
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : 0,
    activeTimeMs: session.activeTimeMs,
    costUSD: session.costUSD,
    totalTokens: totalTokens(session.usage),
    inputTokens: session.usage.inputTokens,
    cacheReadTokens: session.usage.cacheReadTokens,
    sidechainMessageCount: session.sidechainMessageCount,
    turnCount: session.turnCount,
  };
}

const METRIC_KEYS: ReadonlyArray<keyof SessionMetrics> = [
  "editedFileCount",
  "editOpCount",
  "estimatedLinesAdded",
  "estimatedLinesRemoved",
  "interruptionCount",
  "reEditedFileCount",
  "maxEditsPerFile",
  "toolResultCount",
  "toolErrorCount",
  "testRunCount",
  "testFailCount",
  "durationMs",
  "activeTimeMs",
  "costUSD",
  "totalTokens",
  "inputTokens",
  "cacheReadTokens",
  "sidechainMessageCount",
  "turnCount",
];

export function isSessionMetrics(v: unknown): v is SessionMetrics {
  if (!isObject(v)) return false;
  return METRIC_KEYS.every((key) => {
    const n = v[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0;
  });
}

// ---- 派生指標（保存せず都度計算。0 除算は null） ----

const linesChanged = (m: SessionMetrics): number =>
  m.estimatedLinesAdded + m.estimatedLinesRemoved;

/** ツールエラー率（不具合シグナル） */
export function toolErrorRate(m: SessionMetrics): number | null {
  return m.toolResultCount > 0 ? m.toolErrorCount / m.toolResultCount : null;
}

/** キャッシュ読取比率（節約指標）: cacheRead / (input + cacheRead) */
export function cacheReadRatio(m: SessionMetrics): number | null {
  const denom = m.inputTokens + m.cacheReadTokens;
  return denom > 0 ? m.cacheReadTokens / denom : null;
}

/** 工数効率: 推定変更行数 / アクティブ時間(h) */
export function linesPerActiveHour(m: SessionMetrics): number | null {
  return m.activeTimeMs > 0
    ? linesChanged(m) / (m.activeTimeMs / 3_600_000)
    : null;
}

/** コスト効率: 推定変更 100 行あたりの USD */
export function usdPer100Lines(m: SessionMetrics): number | null {
  const lines = linesChanged(m);
  return lines > 0 ? m.costUSD / (lines / 100) : null;
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)}分`;

/** LLM 分析プロンプトに注入する日本語サマリー */
export function formatMetricsForPrompt(m: SessionMetrics): string {
  const errorRate = toolErrorRate(m);
  const cacheRatio = cacheReadRatio(m);
  const lines: string[] = [
    `- 推定変更行数: +${m.estimatedLinesAdded} / -${m.estimatedLinesRemoved}（編集ファイル数: ${m.editedFileCount}、編集操作: ${m.editOpCount}回）`,
    `- 再編集ファイル数: ${m.reEditedFileCount}（最大 ${m.maxEditsPerFile}回/ファイル）`,
    `- ユーザー割り込み: ${m.interruptionCount}回`,
    `- ツールエラー: ${m.toolErrorCount}/${m.toolResultCount}${errorRate !== null ? `（${Math.round(errorRate * 100)}%）` : ""}`,
    `- テスト実行: ${m.testRunCount}回（失敗 ${m.testFailCount}回）`,
    `- 所要時間: ${minutes(m.durationMs)}（アクティブ ${minutes(m.activeTimeMs)}）、ターン数: ${m.turnCount}`,
    `- コスト: $${m.costUSD.toFixed(2)}、総トークン: ${m.totalTokens.toLocaleString("en-US")}`,
  ];
  if (cacheRatio !== null) {
    lines.push(`- キャッシュ読取比率: ${Math.round(cacheRatio * 100)}%`);
  }
  if (m.sidechainMessageCount > 0) {
    lines.push(
      `- サブエージェント（サイドチェーン）メッセージ: ${m.sidechainMessageCount}件`,
    );
  }
  return lines.join("\n");
}
