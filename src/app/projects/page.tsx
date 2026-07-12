"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { FilterPopover } from "@/components/FilterPopover";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import {
  EmptyState,
  ErrorNote,
  SearchInput,
  Section,
  Skeleton,
} from "@/components/ui";
import { useApi } from "@/components/use-api";
import { type ProjectSummary, totalTokens } from "@/lib/types";
import {
  applyProjectView,
  type ProjectSortKey,
  type SortOrder,
} from "@/lib/view/projects-view";

export default function ProjectsPage() {
  const { data, error, loading } = useApi<{ projects: ProjectSummary[] }>(
    "/api/projects",
  );
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectSortKey>("lastAt");
  const [order, setOrder] = useState<SortOrder>("desc");

  const all = useMemo(() => data?.projects ?? [], [data]);
  const view = useMemo(
    () => applyProjectView(all, { query, sortKey, order }),
    [all, query, sortKey, order],
  );

  const toggleSort = (key: ProjectSortKey) => {
    if (sortKey === key) setOrder(order === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setOrder("desc");
    }
  };

  // ラベル（ソート）＋ 任意の絞り込みポップオーバーを内包する見出しセル
  const header = (
    key: ProjectSortKey,
    label: string,
    align = "text-right",
    filter?: ReactNode,
  ) => (
    <th className={`whitespace-nowrap py-2 pr-3 last:pr-0 ${align}`}>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="inline-flex cursor-pointer select-none items-center"
          onClick={() => toggleSort(key)}
        >
          {label}
          {sortKey === key && (
            <span className="ml-0.5">{order === "desc" ? "▼" : "▲"}</span>
          )}
        </button>
        {filter}
      </span>
    </th>
  );

  const nameFilter = (
    <FilterPopover
      label="プロジェクト検索"
      active={query.trim() !== ""}
      align="left"
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="プロジェクト名・パス"
        className="w-60"
      />
    </FilterPopover>
  );

  return (
    <Section title="プロジェクト一覧">
      {error !== null && <ErrorNote message={error} />}
      {loading && <Skeleton className="h-48" />}
      {data !== null &&
        (all.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {query.trim() !== "" && (
              <div className="mb-2 flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                <span className="tabular-nums">
                  {view.length} / {all.length} 件
                </span>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="underline hover:text-black/70 dark:hover:text-white/70"
                >
                  フィルタ解除
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-black/50 dark:text-white/50">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    {header("name", "プロジェクト", "text-left", nameFilter)}
                    {header("sessions", "セッション")}
                    {header("turns", "ターン")}
                    {header("tokens", "トークン")}
                    {header("cost", "コスト")}
                    {header("activeTime", "操作時間")}
                    {header("lastAt", "最終利用")}
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-8 text-center text-sm text-black/40 dark:text-white/40"
                      >
                        条件に一致するプロジェクトがありません
                      </td>
                    </tr>
                  )}
                  {view.map((p) => (
                    <tr
                      key={p.projectId}
                      className="border-b border-black/5 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          href={`/projects/${encodeURIComponent(p.projectId)}`}
                          className="hover:underline"
                          title={p.projectPath}
                        >
                          {p.displayName}
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {p.sessionCount}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {p.turnCount}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatTokens(totalTokens(p.usage))}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatUSD(p.costUSD)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatDurationJa(p.activeTimeMs)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatDateTimeJa(p.lastAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
    </Section>
  );
}
