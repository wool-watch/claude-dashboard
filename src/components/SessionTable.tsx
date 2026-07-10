"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { Badge, EmptyState, InfoNote } from "@/components/ui";
import type { SessionAnalysisStatus } from "@/lib/analysis/types";
import { type SessionListItem, totalTokens } from "@/lib/types";

type SortKey = "lastAt" | "cost" | "turns";

const displayNameOf = (projectPath: string): string => {
  const segments = projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? projectPath;
};

/** モデルIDの表示短縮: claude-opus-4-8 → opus-4-8 */
const shortModel = (model: string): string => model.replace(/^claude-/, "");

/** 実行中・待機中は選択不可（二重投入防止） */
const isSelectableStatus = (status: SessionAnalysisStatus): boolean =>
  status !== "analyzing" && status !== "queued";

function AnalysisStatusBadge({ status }: { status: SessionAnalysisStatus }) {
  switch (status) {
    case "analyzing":
      return <Badge tone="blue">分析中</Badge>;
    case "queued":
      return <Badge tone="gray">待機中</Badge>;
    case "stale":
      return <Badge tone="amber">再分析推奨</Badge>;
    case "analyzed":
      return <Badge tone="green">分析済み</Badge>;
    default:
      return (
        <span className="text-xs text-black/30 dark:text-white/30">未分析</span>
      );
  }
}

export function SessionTable({
  sessions,
  selectable = false,
  onQueued,
}: {
  sessions: SessionListItem[];
  /** 一括分析（チェックボックス + キュー投入）UI を出すか */
  selectable?: boolean;
  /** キュー投入成功後に呼ぶ（一覧の再取得など） */
  onQueued?: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("lastAt");
  const [desc, setDesc] = useState(true);
  const [rawSelected, setRawSelected] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const sign = desc ? -1 : 1;
    return [...sessions].sort((a, b) => {
      switch (sortKey) {
        case "cost":
          return sign * (a.costUSD - b.costUSD);
        case "turns":
          return sign * (a.turnCount - b.turnCount);
        default:
          return sign * a.lastAt.localeCompare(b.lastAt);
      }
    });
  }, [sessions, sortKey, desc]);

  const selectableIds = useMemo(
    () =>
      new Set(
        sessions
          .filter((s) => isSelectableStatus(s.analysisStatus))
          .map((s) => s.sessionId),
      ),
    [sessions],
  );

  // 一覧の自動更新で消えた・選択不可になった ID は選択から除外する（派生値として計算）
  const selected = useMemo(
    () => new Set([...rawSelected].filter((id) => selectableIds.has(id))),
    [rawSelected, selectableIds],
  );

  if (sessions.length === 0) return <EmptyState />;

  const toggle = (sessionId: string) => {
    const next = new Set(selected);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    setRawSelected(next);
  };

  const toggleAll = () => {
    setRawSelected(
      selected.size === selectableIds.size ? new Set() : new Set(selectableIds),
    );
  };

  const submit = async () => {
    setSubmitting(true);
    setNote(null);
    setQueueError(null);
    try {
      const res = await fetch("/api/analysis/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: [...selected] }),
      });
      const body = (await res.json()) as {
        queued?: string[];
        skipped?: string[];
        paused?: boolean;
        error?: string;
      };
      if (!res.ok || body.queued === undefined) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const skippedCount = body.skipped?.length ?? 0;
      setNote(
        body.paused === true
          ? `${body.queued.length}件を追加しましたが、キューは保留中です。ヘッダーの分析状況から再開してください`
          : `${body.queued.length}件をキューに追加しました${
              skippedCount > 0 ? `（${skippedCount}件スキップ）` : ""
            }`,
      );
      setRawSelected(new Set());
      onQueued?.();
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : "キュー投入に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const header = (key: SortKey, label: string, align = "text-right") => (
    <th
      className={`cursor-pointer select-none py-2 ${align}`}
      onClick={() => {
        if (sortKey === key) setDesc(!desc);
        else {
          setSortKey(key);
          setDesc(true);
        }
      }}
    >
      {label}
      {sortKey === key && <span className="ml-0.5">{desc ? "▼" : "▲"}</span>}
    </th>
  );

  return (
    <div>
      {selectable && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-black/60 dark:text-white/60">
            {selected.size}件を選択中
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          >
            {submitting ? "追加中…" : "選択したセッションを分析"}
          </button>
        </div>
      )}
      {note !== null && (
        <div className="mb-2">
          <InfoNote message={note} />
        </div>
      )}
      {queueError !== null && (
        <p className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {queueError}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-black/50 dark:text-white/50">
            <tr className="border-b border-black/10 dark:border-white/15">
              {selectable && (
                <th className="w-8 py-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="すべて選択"
                    disabled={selectableIds.size === 0}
                    checked={
                      selectableIds.size > 0 &&
                      selected.size === selectableIds.size
                    }
                    ref={(el) => {
                      if (el !== null) {
                        el.indeterminate =
                          selected.size > 0 &&
                          selected.size < selectableIds.size;
                      }
                    }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th className="py-2 text-left">タイトル</th>
              <th className="py-2 text-left">プロジェクト</th>
              {header("lastAt", "最終利用", "text-left")}
              {header("turns", "ターン")}
              <th className="py-2 text-left">モデル</th>
              <th className="py-2 text-left">分析</th>
              <th className="py-2 text-right">トークン</th>
              {header("cost", "コスト")}
              <th className="py-2 text-right">操作時間</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.sessionId}
                className="border-b border-black/5 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
              >
                {selectable && (
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${s.title ?? s.sessionId.slice(0, 8)} を選択`}
                      disabled={!isSelectableStatus(s.analysisStatus)}
                      checked={selected.has(s.sessionId)}
                      onChange={() => toggle(s.sessionId)}
                    />
                  </td>
                )}
                <td className="max-w-72 truncate py-2 pr-3">
                  <Link
                    href={`/sessions/${s.sessionId}`}
                    className="hover:underline"
                  >
                    {s.title ?? s.sessionId.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-black/60 dark:text-white/60">
                  {displayNameOf(s.projectPath)}
                </td>
                <td className="py-2 pr-3 tabular-nums text-black/60 dark:text-white/60">
                  {formatDateTimeJa(s.lastAt)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.turnCount}</td>
                <td className="py-2 pr-3">
                  <span className="flex flex-wrap gap-1">
                    {s.models.map((m) => (
                      <Badge key={m} tone="gray">
                        {shortModel(m)}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <AnalysisStatusBadge status={s.analysisStatus} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatTokens(totalTokens(s.usage))}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatUSD(s.costUSD)}
                  {s.costIsEstimated && (
                    <span className="ml-1">
                      <Badge tone="amber">推定</Badge>
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatDurationJa(s.activeTimeMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
