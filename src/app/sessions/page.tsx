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

  const params = new URLSearchParams({ limit: "500" });
  if (project !== null) params.set("project", project);
  const url = `/api/sessions?${params.toString()}`;
  // キュー消化に伴うバッジ変化（待機中→分析中→分析済み）を追従する。
  // 絞り込み・並べ替えは SessionTable のヘッダーが担当する
  const { data, error, loading, refetch } = useApi<{
    sessions: SessionListItem[];
  }>(url, 15_000);

  return (
    <Section
      title={
        project !== null ? `セッション一覧（${project}）` : "セッション一覧"
      }
    >
      {error !== null && <ErrorNote message={error} />}
      {loading && <Skeleton className="h-64" />}
      {data !== null && (
        <SessionTable sessions={data.sessions} selectable onQueued={refetch} />
      )}
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
