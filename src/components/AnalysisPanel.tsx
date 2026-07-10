"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeJa, formatUSD } from "@/components/format";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import type { StoredAnalysis } from "@/lib/analysis/types";

interface AnalysisState {
  analysis: StoredAnalysis | null;
  isStale: boolean;
  /** サーバー側で分析実行中か（別タブ・再読込後も反映される） */
  isAnalyzing: boolean;
  /** 分析キューで待機中か */
  isQueued: boolean;
}

/** 分析中にサーバーへ完了を確認する間隔 */
const POLL_INTERVAL_MS = 3000;

function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">
        {value}
        <span className="text-xs font-normal text-black/40 dark:text-white/40">
          /5
        </span>
      </div>
    </div>
  );
}

export function AnalysisPanel({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<AnalysisState | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const res = await fetch(`/api/sessions/${sessionId}/analysis`, {
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AnalysisState;
      setState(body);
      setAnalyzing(body.isAnalyzing);
      setQueued(body.isQueued);
    },
    [sessionId],
  );

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

  // サーバー側で分析実行中・キュー待機中の間はポーリングして進行を追従する
  // （待機中 → 分析中 → 完了と遷移する）
  useEffect(() => {
    if (!analyzing && !queued) return;
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
  }, [analyzing, queued, fetchState]);

  const releaseFromQueue = useCallback(async () => {
    try {
      await fetch(`/api/analysis/queue/${sessionId}`, { method: "DELETE" });
    } finally {
      fetchState().catch(() => {
        // 一時的な失敗は次のポーリングに任せる
      });
    }
  }, [sessionId, fetchState]);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
      });
      const body = (await res.json()) as AnalysisState & { error?: string };
      if (res.status === 409) {
        // 別タブ等で実行中 → ポーリングで完了を待つ
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setState({ analysis: body.analysis, isStale: body.isStale, isAnalyzing: false });
      setAnalyzing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析に失敗しました");
      setAnalyzing(false);
    }
  }, [sessionId]);

  if (loading) return <Skeleton className="h-24" />;

  const analysis = state?.analysis ?? null;

  const analyzeButton = (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void analyze()}
        disabled={analyzing || queued}
        className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
      >
        {analyzing
          ? "分析中…（数十秒かかります）"
          : queued
            ? "キュー待機中"
            : analysis !== null
              ? "再分析"
              : "このセッションを分析する"}
      </button>
      {queued && !analyzing && (
        <button
          type="button"
          onClick={() => void releaseFromQueue()}
          className="rounded-md border border-black/10 px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
        >
          キューから解除
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-3">
      {analysis === null ? (
        <div className="space-y-2 text-center">
          <EmptyState message="まだ分析されていません。Claude Code CLI でこのセッションのやり取りを分析し、指示の良かった点・改善点を振り返ります" />
          <div>{analyzeButton}</div>
        </div>
      ) : (
        <>
          <p className="text-sm">{analysis.result.summary}</p>

          <div className="grid grid-cols-3 gap-3">
            <ScoreCard
              label="指示の明確さ"
              value={analysis.result.scores.instructionClarity}
            />
            <ScoreCard label="進行の効率" value={analysis.result.scores.efficiency} />
            <ScoreCard
              label="目的の達成度"
              value={analysis.result.scores.goalAchievement}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                良かった点
              </h3>
              <ul className="space-y-1 text-sm">
                {analysis.result.goodPoints.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <span aria-hidden>✓</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                次回への改善点
              </h3>
              <ul className="space-y-1 text-sm">
                {analysis.result.improvements.map((item) => (
                  <li key={item.point} className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="amber">{item.category}</Badge>
                    <span>{item.point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-2 text-xs text-black/50 dark:border-white/15 dark:text-white/50">
            <span>
              {formatDateTimeJa(analysis.analyzedAt)} 分析 ・ {analysis.model}
              {analysis.costUSD !== null && ` ・ ${formatUSD(analysis.costUSD)}`}
            </span>
            {state?.isStale === true && (
              <Badge tone="amber">セッション更新あり・再分析推奨</Badge>
            )}
            <span className="ml-auto">{analyzeButton}</span>
          </div>
        </>
      )}
      {error !== null && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
