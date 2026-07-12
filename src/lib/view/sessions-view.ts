import type { SessionAnalysisStatus } from "@/lib/analysis/types";
import type { SessionSourceId } from "@/lib/sources/types";
import { type SessionListItem, totalTokens } from "@/lib/types";
import type { SortOrder } from "@/lib/view/types";

export type { SortOrder };

/** セッション一覧で並べ替え可能な列 */
export type SessionSortKey =
  | "lastAt"
  | "firstAt"
  | "title"
  | "turns"
  | "tokens"
  | "cost"
  | "activeTime";

export interface SessionViewState {
  /** タイトル・プロジェクト・モデルを対象としたフリーテキスト検索 */
  query: string;
  /** 選択されたソース集合（空集合は全ソース） */
  sources: ReadonlySet<SessionSourceId>;
  /** 選択された分析ステータス集合（空集合は全ステータス） */
  statuses: ReadonlySet<SessionAnalysisStatus>;
  sortKey: SessionSortKey;
  order: SortOrder;
}

/** filterSessions が参照する絞り込み条件（並べ替えは含まない） */
export type SessionFilter = Pick<
  SessionViewState,
  "query" | "sources" | "statuses"
>;

export const DEFAULT_SESSION_VIEW: SessionViewState = {
  query: "",
  sources: new Set(),
  statuses: new Set(),
  sortKey: "lastAt",
  order: "desc",
};

/** projectPath の末尾セグメント（表示名相当） */
const displayNameOf = (projectPath: string): string => {
  const segments = projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? projectPath;
};

const matchesQuery = (s: SessionListItem, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystacks = [
    s.title ?? "",
    s.sessionId,
    s.projectPath,
    displayNameOf(s.projectPath),
    ...s.models,
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
};

export function filterSessions(
  sessions: readonly SessionListItem[],
  filter: SessionFilter,
): SessionListItem[] {
  return sessions.filter(
    (s) =>
      matchesQuery(s, filter.query) &&
      (filter.sources.size === 0 || filter.sources.has(s.source)) &&
      (filter.statuses.size === 0 || filter.statuses.has(s.analysisStatus)),
  );
}

const compare = (
  a: SessionListItem,
  b: SessionListItem,
  key: SessionSortKey,
): number => {
  switch (key) {
    case "firstAt":
      return a.firstAt.localeCompare(b.firstAt);
    case "title":
      return (a.title ?? a.sessionId).localeCompare(b.title ?? b.sessionId, "ja");
    case "turns":
      return a.turnCount - b.turnCount;
    case "tokens":
      return totalTokens(a.usage) - totalTokens(b.usage);
    case "cost":
      return a.costUSD - b.costUSD;
    case "activeTime":
      return a.activeTimeMs - b.activeTimeMs;
    default:
      return a.lastAt.localeCompare(b.lastAt);
  }
};

export function sortSessions(
  sessions: readonly SessionListItem[],
  key: SessionSortKey,
  order: SortOrder,
): SessionListItem[] {
  const sign = order === "asc" ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const primary = sign * compare(a, b, key);
    // 同値は常に最終利用の新しい順で安定させる
    return primary !== 0 ? primary : b.lastAt.localeCompare(a.lastAt);
  });
}

export function applySessionView(
  sessions: readonly SessionListItem[],
  state: SessionViewState,
): SessionListItem[] {
  return sortSessions(
    filterSessions(sessions, state),
    state.sortKey,
    state.order,
  );
}
