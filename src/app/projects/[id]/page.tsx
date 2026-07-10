"use client";

import { useParams } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { DashboardView } from "@/components/DashboardView";
import { formatDateTimeJa } from "@/components/format";
import { SessionTable } from "@/components/SessionTable";
import { EmptyState, ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { ProjectSummary, SessionListItem } from "@/lib/types";

export default function ProjectDashboardPage() {
  const params = useParams<{ id: string }>();
  const projectId = decodeURIComponent(params.id);

  const projects = useApi<{ projects: ProjectSummary[] }>("/api/projects");
  // キュー消化に伴うバッジ変化（待機中→分析中→分析済み）を追従する
  const sessions = useApi<{ sessions: SessionListItem[] }>(
    `/api/sessions?limit=500&project=${encodeURIComponent(projectId)}`,
    15_000,
  );

  if (projects.error !== null) return <ErrorNote message={projects.error} />;
  if (projects.loading) return <Skeleton className="h-96" />;

  const project =
    projects.data?.projects.find((p) => p.projectId === projectId) ?? null;
  if (project === null) {
    return <EmptyState message="プロジェクトが見つかりません" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2">
          <BackButton fallbackHref="/projects" />
        </div>
        <h1 className="text-lg font-semibold">{project.displayName}</h1>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          {project.projectPath} ・ セッション{project.sessionCount}件 ・
          最終利用 {formatDateTimeJa(project.lastAt)}
        </p>
      </div>

      <DashboardView projectId={projectId} />

      <Section title="セッション一覧">
        {sessions.error !== null && <ErrorNote message={sessions.error} />}
        {sessions.loading && <Skeleton className="h-64" />}
        {sessions.data !== null && (
          <SessionTable
            sessions={sessions.data.sessions}
            selectable
            onQueued={sessions.refetch}
          />
        )}
      </Section>
    </div>
  );
}
