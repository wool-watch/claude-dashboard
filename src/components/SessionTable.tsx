"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { FilterPopover } from "@/components/FilterPopover";
import { Badge, EmptyState, InfoNote, SearchInput } from "@/components/ui";
import type { SessionAnalysisStatus } from "@/lib/analysis/types";
import {
  SESSION_SOURCE_IDS,
  SESSION_SOURCE_LABELS,
  type SessionSourceId,
} from "@/lib/sources/types";
import { type SessionListItem, totalTokens } from "@/lib/types";
import {
  filterSessions,
  type SessionSortKey,
  sortSessions,
} from "@/lib/view/sessions-view";

const displayNameOf = (projectPath: string): string => {
  const segments = projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? projectPath;
};

/** モデルIDの表示短縮: claude-opus-4-8 → opus-4-8 */
const shortModel = (model: string): string => model.replace(/^claude-/, "");

function SourceBadge({ source }: { source: SessionListItem["source"] }) {
  const tone =
    source === "codex" ? "blue" : source === "gemini" ? "amber" : "gray";
  return <Badge tone={tone}>{SESSION_SOURCE_LABELS[source]}</Badge>;
}

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

/** 分析ステータスの絞り込み選択肢（表示順） */
const STATUS_OPTIONS: { id: SessionAnalysisStatus; label: string }[] = [
  { id: "analyzed", label: "分析済み" },
  { id: "stale", label: "再分析推奨" },
  { id: "none", label: "未分析" },
  { id: "queued", label: "待機中" },
  { id: "analyzing", label: "分析中" },
];

function CheckboxItem({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
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
  const [sortKey, setSortKey] = useState<SessionSortKey>("lastAt");
  const [desc, setDesc] = useState(true);
  const [rawSelected, setRawSelected] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<ReadonlySet<SessionSourceId>>(
    new Set(),
  );
  const [statuses, setStatuses] = useState<ReadonlySet<SessionAnalysisStatus>>(
    new Set(),
  );

  // 絞り込み → 並べ替えの順で適用
  const view = useMemo(
    () =>
      sortSessions(
        filterSessions(sessions, { query, sources, statuses }),
        sortKey,
        desc ? "desc" : "asc",
      ),
    [sessions, query, sources, statuses, sortKey, desc],
  );

  // 一括分析の対象は表示中（フィルタ後）の選択可能な行に限る
  const selectableIds = useMemo(
    () =>
      new Set(
        view
          .filter((s) => isSelectableStatus(s.analysisStatus))
          .map((s) => s.sessionKey),
      ),
    [view],
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

  const toggleInSet = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const hasFilter =
    query.trim() !== "" || sources.size > 0 || statuses.size > 0;
  const clearFilters = () => {
    setQuery("");
    setSources(new Set());
    setStatuses(new Set());
  };

  const toggleSort = (key: SessionSortKey) => {
    if (sortKey === key) setDesc(!desc);
    else {
      setSortKey(key);
      setDesc(true);
    }
  };

  // ラベル（ソート）＋ 任意の絞り込みポップオーバーを内包する見出しセル
  const header = (
    key: SessionSortKey | null,
    label: string,
    align = "text-right",
    filter?: ReactNode,
  ) => (
    <th className={`whitespace-nowrap py-2 pr-3 last:pr-0 ${align}`}>
      <span className="inline-flex items-center gap-1">
        {key !== null ? (
          <button
            type="button"
            className="inline-flex cursor-pointer select-none items-center"
            onClick={() => toggleSort(key)}
          >
            {label}
            {sortKey === key && (
              <span className="ml-0.5">{desc ? "▼" : "▲"}</span>
            )}
          </button>
        ) : (
          <span>{label}</span>
        )}
        {filter}
      </span>
    </th>
  );

  const sourceFilter = (
    <FilterPopover label="ソース" active={sources.size > 0} align="left">
      <div className="flex flex-col gap-0.5">
        {SESSION_SOURCE_IDS.map((id) => (
          <CheckboxItem
            key={id}
            checked={sources.has(id)}
            onChange={() => setSources((prev) => toggleInSet(prev, id))}
          >
            {SESSION_SOURCE_LABELS[id]}
          </CheckboxItem>
        ))}
      </div>
    </FilterPopover>
  );

  const statusFilter = (
    <FilterPopover label="分析" active={statuses.size > 0} align="left">
      <div className="flex flex-col gap-0.5">
        {STATUS_OPTIONS.map((opt) => (
          <CheckboxItem
            key={opt.id}
            checked={statuses.has(opt.id)}
            onChange={() => setStatuses((prev) => toggleInSet(prev, opt.id))}
          >
            {opt.label}
          </CheckboxItem>
        ))}
      </div>
    </FilterPopover>
  );

  const titleFilter = (
    <FilterPopover label="タイトル検索" active={query.trim() !== ""} align="left">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="タイトル・プロジェクト・モデル"
        className="w-60"
      />
    </FilterPopover>
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
      {hasFilter && (
        <div className="mb-2 flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
          <span className="tabular-nums">
            {view.length} / {sessions.length} 件
          </span>
          <button
            type="button"
            onClick={clearFilters}
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
              {header("title", "タイトル", "text-left", titleFilter)}
              {header(null, "ソース", "text-left", sourceFilter)}
              <th className="whitespace-nowrap py-2 pr-3 text-left">プロジェクト</th>
              {header("lastAt", "最終利用", "text-left")}
              {header("turns", "ターン")}
              <th className="whitespace-nowrap py-2 pr-3 text-left">モデル</th>
              {header(null, "分析", "text-left", statusFilter)}
              {header("tokens", "トークン")}
              {header("cost", "コスト")}
              {header("activeTime", "操作時間")}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td
                  colSpan={selectable ? 11 : 10}
                  className="py-8 text-center text-sm text-black/40 dark:text-white/40"
                >
                  条件に一致するセッションがありません
                </td>
              </tr>
            )}
            {view.map((s) => (
              <tr
                key={s.sessionKey}
                className="border-b border-black/5 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
              >
                {selectable && (
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${s.title ?? s.sessionId.slice(0, 8)} を選択`}
                      disabled={!isSelectableStatus(s.analysisStatus)}
                      checked={selected.has(s.sessionKey)}
                      onChange={() => toggle(s.sessionKey)}
                    />
                  </td>
                )}
                <td className="max-w-72 truncate py-2 pr-3">
                  <Link
                    href={`/sessions/${encodeURIComponent(s.sessionKey)}`}
                    className="hover:underline"
                  >
                    {s.title ?? s.sessionId.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <SourceBadge source={s.source} />
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
