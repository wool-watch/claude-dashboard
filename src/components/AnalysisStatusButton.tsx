"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDurationJa } from "@/components/format";
import { useApi } from "@/components/use-api";
import type { QueueItemState } from "@/lib/analysis/queue-types";

interface QueueItemDto {
  sessionId: string;
  state: QueueItemState;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  title: string | null;
  projectId: string | null;
  projectPath: string | null;
}

interface QueueDto {
  paused: boolean;
  items: QueueItemDto[];
  counts: { pending: number; running: number; failed: number };
}

/** 全ページ共通のヘッダーからキュー状態を追従する間隔 */
const POLL_INTERVAL_MS = 5_000;
/** 再開確認モーダルをブラウザタブごとに1回だけ自動表示するためのフラグ */
const RESUME_PROMPTED_KEY = "queue-resume-prompted";

const itemLabel = (item: QueueItemDto): string =>
  item.title ?? item.sessionId.slice(0, 8);

const projectNameOf = (item: QueueItemDto): string | null => {
  if (item.projectPath === null) return null;
  const segments = item.projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? item.projectPath;
};

export function AnalysisStatusButton() {
  const [open, setOpen] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<
    "idle" | "open" | "dismissed"
  >("idle");
  const rootRef = useRef<HTMLSpanElement>(null);
  const { data, refetch } = useApi<QueueDto>(
    "/api/analysis/queue",
    POLL_INTERVAL_MS,
  );

  const counts = data?.counts ?? { pending: 0, running: 0, failed: 0 };
  const paused = data?.paused === true;
  const pausedPending = paused && counts.pending > 0;
  const activeCount = counts.pending + counts.running;
  const resumePromptOpen = resumePrompt === "open";

  // 起動時の確認画面: 保留中の未完了を初めて検知したらタブごとに1回だけ出す
  useEffect(() => {
    if (!pausedPending || resumePrompt !== "idle") return;
    const timer = setTimeout(() => {
      try {
        if (sessionStorage.getItem(RESUME_PROMPTED_KEY) !== null) {
          setResumePrompt("dismissed");
          return;
        }
        sessionStorage.setItem(RESUME_PROMPTED_KEY, "1");
        setResumePrompt("open");
      } catch {
        // sessionStorage 不可の環境ではパネルの保留バナーだけを導線にする
        setResumePrompt("dismissed");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pausedPending, resumePrompt]);

  // 外側クリック / Escape でパネルを閉じる
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const resume = async () => {
    try {
      await fetch("/api/analysis/queue/resume", { method: "POST" });
    } finally {
      setResumePrompt("dismissed");
      refetch();
    }
  };

  const release = async (item: QueueItemDto) => {
    if (
      item.state === "running" &&
      !window.confirm("実行中の分析を中止しますか？")
    ) {
      return;
    }
    try {
      await fetch(`/api/analysis/queue/${item.sessionId}`, {
        method: "DELETE",
      });
    } finally {
      refetch();
    }
  };

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={pausedPending ? "保留中の分析があります" : "分析状況"}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
          pausedPending
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
            : "border-black/10 text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
        }`}
      >
        分析状況
        {activeCount > 0 && !paused && (
          <>
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500"
              aria-hidden
            />
            <span>
              実行中{counts.running}・待機{counts.pending}
            </span>
          </>
        )}
        {pausedPending && <span>保留{counts.pending}</span>}
        {activeCount === 0 && counts.failed > 0 && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
            title={`失敗${counts.failed}件`}
            aria-label={`失敗${counts.failed}件`}
          />
        )}
      </button>
      {open && (
        <AnalysisQueuePanel
          data={data}
          onResume={() => void resume()}
          onRelease={(item) => void release(item)}
        />
      )}
      {resumePromptOpen && data !== null && (
        <ResumeConfirmModal
          pendingItems={data.items.filter((i) => i.state === "pending")}
          onResume={() => void resume()}
          onKeepPaused={() => setResumePrompt("dismissed")}
        />
      )}
    </span>
  );
}

function AnalysisQueuePanel({
  data,
  onResume,
  onRelease,
}: {
  data: QueueDto | null;
  onResume: () => void;
  onRelease: (item: QueueItemDto) => void;
}) {
  const items = data?.items ?? [];
  const paused = data?.paused === true;
  const running = items.filter((i) => i.state === "running");
  const pending = items.filter((i) => i.state === "pending");
  const failed = items.filter((i) => i.state === "failed");

  return (
    <div className="absolute right-0 z-10 mt-2 w-80 rounded-md border border-black/10 bg-white p-3 text-left shadow-lg dark:border-white/15 dark:bg-neutral-900">
      {paused && pending.length > 0 && (
        <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            前回終了時の未完了の分析が {pending.length} 件残っています
          </p>
          <button
            type="button"
            onClick={onResume}
            className="mt-1.5 rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            再開する
          </button>
        </div>
      )}

      {running.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-semibold">実行中</p>
          {running.map((item) => (
            <div key={item.sessionId} className="flex items-center gap-2 py-0.5">
              <Link
                href={`/sessions/${item.sessionId}`}
                className="min-w-0 flex-1 truncate text-xs hover:underline"
                title={itemLabel(item)}
              >
                {itemLabel(item)}
              </Link>
              <span className="shrink-0 text-[10px] text-black/50 dark:text-white/50">
                {projectNameOf(item)}
                {item.startedAt !== undefined && (
                  <>
                    {" ・ "}
                    <ElapsedTime since={item.startedAt} />
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => onRelease(item)}
                className="shrink-0 rounded border border-red-500/30 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                中止
              </button>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-semibold">待機中（{pending.length}件）</p>
          {pending.map((item) => (
            <div key={item.sessionId} className="flex items-center gap-2 py-0.5">
              <Link
                href={`/sessions/${item.sessionId}`}
                className="min-w-0 flex-1 truncate text-xs hover:underline"
                title={itemLabel(item)}
              >
                {itemLabel(item)}
              </Link>
              <span className="shrink-0 text-[10px] text-black/50 dark:text-white/50">
                {projectNameOf(item)}
              </span>
              <button
                type="button"
                onClick={() => onRelease(item)}
                className="shrink-0 rounded border border-black/10 px-1.5 py-0.5 text-[10px] text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
              >
                解除
              </button>
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <details className="mb-1">
          <summary className="cursor-pointer text-xs font-semibold">
            最近の失敗（{failed.length}件）
          </summary>
          {failed.map((item) => (
            <div key={item.sessionId} className="mt-1 rounded border border-red-500/20 px-2 py-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/sessions/${item.sessionId}`}
                  className="min-w-0 flex-1 truncate text-xs hover:underline"
                  title={itemLabel(item)}
                >
                  {itemLabel(item)}
                </Link>
                <button
                  type="button"
                  onClick={() => onRelease(item)}
                  className="shrink-0 rounded border border-black/10 px-1.5 py-0.5 text-[10px] text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
                >
                  閉じる
                </button>
              </div>
              <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                {item.error}
              </p>
            </div>
          ))}
        </details>
      )}

      {running.length === 0 && pending.length === 0 && failed.length === 0 && (
        <p className="py-2 text-center text-xs text-black/50 dark:text-white/50">
          実行中・待機中の分析はありません
        </p>
      )}
    </div>
  );
}

/** 実行中項目の経過時間。render を純粋に保つため時刻は interval で state に取り込む */
function ElapsedTime({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return null;
  return <>{formatDurationJa(Math.max(0, now - Date.parse(since)))}</>;
}

function ResumeConfirmModal({
  pendingItems,
  onResume,
  onKeepPaused,
}: {
  pendingItems: QueueItemDto[];
  onResume: () => void;
  onKeepPaused: () => void;
}) {
  // Escape は「保留のまま」と同じ（キューは初期化しない）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKeepPaused();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeepPaused]);

  const shown = pendingItems.slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onKeepPaused();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="分析の再開確認"
        className="w-full max-w-md rounded-lg border border-black/10 bg-white p-4 text-left shadow-xl dark:border-white/15 dark:bg-neutral-900"
      >
        <h2 className="text-sm font-semibold">分析の再開確認</h2>
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">
          前回終了時に未完了の分析が {pendingItems.length} 件あります。分析を再開しますか？
        </p>
        <ul className="mt-2 space-y-0.5 text-xs text-black/70 dark:text-white/70">
          {shown.map((item) => (
            <li key={item.sessionId} className="truncate">
              ・{itemLabel(item)}
            </li>
          ))}
          {pendingItems.length > shown.length && (
            <li className="text-black/50 dark:text-white/50">
              ほか {pendingItems.length - shown.length} 件
            </li>
          )}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onKeepPaused}
            className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
          >
            保留のまま
          </button>
          <button
            type="button"
            onClick={onResume}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            再開する
          </button>
        </div>
      </div>
    </div>
  );
}
