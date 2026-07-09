"use client";

import Link from "next/link";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { EmptyState, ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { type ProjectSummary, totalTokens } from "@/lib/types";

export default function ProjectsPage() {
  const { data, error, loading } = useApi<{ projects: ProjectSummary[] }>(
    "/api/projects",
  );

  return (
    <Section title="プロジェクト一覧">
      {error !== null && <ErrorNote message={error} />}
      {loading && <Skeleton className="h-48" />}
      {data !== null &&
        (data.projects.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 dark:text-white/50">
              <tr className="border-b border-black/10 dark:border-white/15">
                <th className="py-2 text-left">プロジェクト</th>
                <th className="py-2 text-right">セッション</th>
                <th className="py-2 text-right">ターン</th>
                <th className="py-2 text-right">トークン</th>
                <th className="py-2 text-right">コスト</th>
                <th className="py-2 text-right">操作時間</th>
                <th className="py-2 text-right">最終利用</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr
                  key={p.projectId}
                  className="border-b border-black/5 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`/sessions?project=${encodeURIComponent(p.projectId)}`}
                      className="hover:underline"
                      title={p.projectPath}
                    >
                      {p.displayName}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.sessionCount}
                  </td>
                  <td className="py-2 text-right tabular-nums">{p.turnCount}</td>
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
        ))}
    </Section>
  );
}
