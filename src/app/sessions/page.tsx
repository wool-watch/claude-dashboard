"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SessionTable } from "@/components/SessionTable";
import { ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { SESSION_SOURCE_IDS, SESSION_SOURCE_LABELS, type SessionSourceId } from "@/lib/sources/types";
import type { SessionListItem } from "@/lib/types";

function SessionsContent() {
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  const [source, setSource] = useState<SessionSourceId | null>(null);
  const params = new URLSearchParams({ limit: "500" });
  if (project !== null) params.set("project", project);
  if (source !== null) params.set("source", source);
  const url = `/api/sessions?${params.toString()}`;
  // キュー消化に伴うバッジ変化（待機中→分析中→分析済み）を追従する
  const { data, error, loading, refetch } = useApi<{
    sessions: SessionListItem[];
  }>(url, 15_000);

  const chipClass = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${
      active
        ? "border-black/30 bg-black/10 dark:border-white/40 dark:bg-white/15"
        : "border-black/10 text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
    }`;

  return (
    <Section
      title={
        project !== null ? `セッション一覧（${project}）` : "セッション一覧"
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={chipClass(source === null)}
          onClick={() => setSource(null)}
        >
          すべて
        </button>
        {SESSION_SOURCE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={chipClass(source === id)}
            onClick={() => setSource(source === id ? null : id)}
          >
            {SESSION_SOURCE_LABELS[id]}
          </button>
        ))}
      </div>
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
