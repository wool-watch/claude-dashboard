"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeJa, formatUSD } from "@/components/format";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import type {
  PriorityAnalysisModel,
  StoredPriorityAnalysis,
} from "@/lib/analysis/priority-types";

interface PriorityState {
  priority: StoredPriorityAnalysis | null;
  /** サーバー側で分析実行中か（モーダルを閉じても実行は継続する） */
  isAnalyzing: boolean;
}

/** 分析中にサーバーへ完了を確認する間隔 */
const POLL_INTERVAL_MS = 3000;

const MODEL_OPTIONS: ReadonlyArray<{
  value: PriorityAnalysisModel;
  label: string;
}> = [
  { value: "haiku", label: "Haiku（高速・低コスト）" },
  { value: "sonnet", label: "Sonnet（高精度）" },
  { value: "opus", label: "Opus（最高精度）" },
];

export function PriorityAnalysisModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // 閉じている間はアンマウントし、再オープン時に状態を初期化して再取得する
  if (!open) return null;
  return <ModalBody onClose={onClose} />;
}

function ModalBody({ onClose }: { onClose: () => void }) {
  const [priority, setPriority] = useState<StoredPriorityAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PriorityAnalysisModel>("sonnet");

  const fetchState = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const res = await fetch("/api/analysis/priority", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PriorityState;
      setPriority(body.priority);
      setAnalyzing(body.isAnalyzing);
    },
    [],
  );

  // オープン時に前回結果と実行中状態を取得
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        await fetchState(controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          setError("分析結果の取得に失敗しました");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetchState]);

  // サーバー側で分析実行中の間はポーリングして完了を検知する
  useEffect(() => {
    if (!analyzing) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetchState(controller.signal).catch(() => {
        // 一時的な失敗は次のポーリングに任せる
      });
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [analyzing, fetchState]);

  // Escape で閉じる
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis/priority", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = (await res.json()) as {
        priority?: StoredPriorityAnalysis;
        error?: string;
      };
      if (res.status === 409) {
        // 既に実行中 → ポーリングで完了を待つ
        return;
      }
      if (!res.ok || body.priority === undefined) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPriority(body.priority);
      setAnalyzing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析に失敗しました");
      setAnalyzing(false);
    }
  }, [model]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="優先課題の分析"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-black/10 bg-white p-4 shadow-xl dark:border-white/15 dark:bg-neutral-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">優先課題の分析</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded px-2 py-1 text-sm text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-black/50 dark:text-white/50">
          保存済みのAI振り返り（直近最大20セッション分の改善点）から、優先度の高い課題をAIがピックアップし、具体的な改善アクションを提案します
        </p>

        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={analyzing || loading}
            className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
          >
            {analyzing ? "分析中…（数十秒かかります）" : "分析開始"}
          </button>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as PriorityAnalysisModel)}
            disabled={analyzing || loading}
            aria-label="分析モデル"
            className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/15 dark:bg-neutral-900"
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error !== null && (
          <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <Skeleton className="h-32" />
        ) : priority === null ? (
          analyzing ? (
            <Skeleton className="h-24" />
          ) : (
            <EmptyState message="まだ実行されていません。「分析開始」を押すと優先課題をピックアップします" />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{priority.result.summary}</p>

            {priority.result.pickedIssues.map((issue) => (
              <div
                key={issue.point}
                className="rounded-lg border border-black/10 p-3 dark:border-white/15"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="amber">{issue.category}</Badge>
                  <span className="text-sm font-semibold">{issue.point}</span>
                </div>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  {issue.reason}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {issue.actions.map((action) => (
                    <li key={action} className="flex gap-1.5">
                      <span aria-hidden>→</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="border-t border-black/10 pt-2 text-xs text-black/50 dark:border-white/15 dark:text-white/50">
              {formatDateTimeJa(priority.analyzedAt)} 分析 ・ {priority.model} ・
              対象{priority.analyzedSessionCount}件
              {priority.costUSD !== null && ` ・ ${formatUSD(priority.costUSD)}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
