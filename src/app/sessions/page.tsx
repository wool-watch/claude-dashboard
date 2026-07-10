"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SessionTable } from "@/components/SessionTable";
import { ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { SessionListItem } from "@/lib/types";

function SessionsContent() {
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  const url =
    project !== null
      ? `/api/sessions?limit=500&project=${encodeURIComponent(project)}`
      : "/api/sessions?limit=500";
  const { data, error, loading } = useApi<{ sessions: SessionListItem[] }>(url);

  return (
    <Section
      title={
        project !== null ? `セッション一覧（${project}）` : "セッション一覧"
      }
    >
      {error !== null && <ErrorNote message={error} />}
      {loading && <Skeleton className="h-64" />}
      {data !== null && <SessionTable sessions={data.sessions} />}
    </Section>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SessionsContent />
    </Suspense>
  );
}
