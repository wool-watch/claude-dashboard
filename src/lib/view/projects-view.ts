import { type ProjectSummary, totalTokens } from "@/lib/types";
import type { SortOrder } from "@/lib/view/types";

export type { SortOrder };

/** プロジェクト一覧で並べ替え可能な列 */
export type ProjectSortKey =
  | "name"
  | "sessions"
  | "turns"
  | "tokens"
  | "cost"
  | "activeTime"
  | "lastAt";

export interface ProjectViewState {
  /** 表示名・プロジェクトパスを対象としたフリーテキスト検索 */
  query: string;
  sortKey: ProjectSortKey;
  order: SortOrder;
}

export const DEFAULT_PROJECT_VIEW: ProjectViewState = {
  query: "",
  sortKey: "lastAt",
  order: "desc",
};

const matchesQuery = (p: ProjectSummary, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    p.displayName.toLowerCase().includes(needle) ||
    p.projectPath.toLowerCase().includes(needle)
  );
};

export function filterProjects(
  projects: readonly ProjectSummary[],
  state: ProjectViewState,
): ProjectSummary[] {
  return projects.filter((p) => matchesQuery(p, state.query));
}

const compare = (
  a: ProjectSummary,
  b: ProjectSummary,
  key: ProjectSortKey,
): number => {
  switch (key) {
    case "name":
      return a.displayName.localeCompare(b.displayName, "ja");
    case "sessions":
      return a.sessionCount - b.sessionCount;
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

export function sortProjects(
  projects: readonly ProjectSummary[],
  key: ProjectSortKey,
  order: SortOrder,
): ProjectSummary[] {
  const sign = order === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => {
    const primary = sign * compare(a, b, key);
    // 同値は常に最終利用の新しい順で安定させる
    return primary !== 0 ? primary : b.lastAt.localeCompare(a.lastAt);
  });
}

export function applyProjectView(
  projects: readonly ProjectSummary[],
  state: ProjectViewState,
): ProjectSummary[] {
  return sortProjects(
    filterProjects(projects, state),
    state.sortKey,
    state.order,
  );
}
