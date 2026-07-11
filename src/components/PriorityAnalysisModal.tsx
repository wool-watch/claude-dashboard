"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeJa, formatUSD } from "@/components/format";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import type { PriorityActionKind } from "@/lib/analysis/practices";
import { practiceNameOf } from "@/lib/analysis/practices";
import type {
  PriorityAnalysisModel,
  StoredPriorityAnalysis,
} from "@/lib/analysis/priority-types";
import { PROVIDER_LABELS } from "@/lib/analysis/provider-labels";
import type { ProviderId } from "@/lib/settings/settings";

interface PriorityState {
  priority: StoredPriorityAnalysis | null;
  /** サーバー側で分析実行中か（モーダルを閉じても実行は継続する） */
  isAnalyzing: boolean;
  /** 旧形式（v1/v2）が保存されている = 再分析すると新形式になる */
  isLegacy: boolean;
}

/** アクションの実施手段種別ごとのバッジ色（カテゴリの amber と区別する） */
const KIND_TONES: Record<PriorityActionKind, "blue" | "purple" | "green" | "gray"> = {
  依頼プロンプト: "blue",
  "CLAUDE.md": "purple",
  ワークフロー: "green",
  "設定・ツール": "gray",
};

/** スニペットをクリップボードへコピーするボタン（2秒間だけ完了表示） */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="rounded border border-black/10 bg-white/80 px-1.5 py-0.5 text-[11px] text-black/60 hover:bg-black/5 dark:border-white/15 dark:bg-neutral-800/80 dark:text-white/60 dark:hover:bg-white/10"
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
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
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  /** 指定するとプロジェクト単位の優先課題分析になる（保存もプロジェクト別） */
  projectId?: string;
}) {
  // 閉じている間はアンマウントし、再オープン時に状態を初期化して再取得する
  if (!open) return null;
  return <ModalBody onClose={onClose} projectId={projectId} />;
}

function ModalBody({
  onClose,
  projectId,
}: {
  onClose: () => void;
  projectId?: string;
}) {
  const [priority, setPriority] = useState<StoredPriorityAnalysis | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PriorityAnalysisModel>("sonnet");
  // アクティブプロバイダ（claude 以外ではモデル選択を出さず設定モデルで実行する）
  const [providerInfo, setProviderInfo] = useState<{
    provider: ProviderId;
    model: string;
  } | null>(null);

  const apiUrl =
    projectId === undefined
      ? "/api/analysis/priority"
      : `/api/analysis/priority?project=${encodeURIComponent(projectId)}`;

  const fetchState = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const res = await fetch(apiUrl, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PriorityState;
      setPriority(body.priority);
      setLegacy(body.isLegacy);
      setAnalyzing(body.isAnalyzing);
    },
    [apiUrl],
  );

  // オープン時にアクティブプロバイダを取得（失敗時は claude 相当の表示にフォールバック）
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/settings", { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          analysisProvider: ProviderId;
          providers: Record<ProviderId, { model: string }>;
        };
        setProviderInfo({
          provider: body.analysisProvider,
          model: body.providers[body.analysisProvider].model,
        });
      } catch {
        // 取得失敗時は claude 既定のUIのまま
      }
    })();
    return () => controller.abort();
  }, []);

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
      // claude のみモデルを指定できる。他プロバイダは設定モデルで実行（body に含めない）
      const isClaude = providerInfo === null || providerInfo.provider === "claude";
      const res = await fetch("/api/analysis/priority", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isClaude && { model }),
          ...(projectId !== undefined && { project: projectId }),
        }),
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
      setLegacy(false);
      setAnalyzing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析に失敗しました");
      setAnalyzing(false);
    }
  }, [model, projectId, providerInfo]);

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
          {projectId === undefined
            ? "保存済みのAI振り返り（直近最大20セッション分の改善点）から、優先度の高い課題をAIがピックアップし、具体的な改善アクションを提案します"
            : "このプロジェクトの保存済みAI振り返り（直近最大20セッション分の改善点）から、優先度の高い課題をAIがピックアップし、具体的な改善アクションを提案します"}
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
          {providerInfo === null || providerInfo.provider === "claude" ? (
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
          ) : (
            <span className="text-xs text-black/50 dark:text-white/50">
              使用: {PROVIDER_LABELS[providerInfo.provider]}
              {providerInfo.model !== "" && ` / ${providerInfo.model}`}
            </span>
          )}
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
            <EmptyState
              message={
                legacy
                  ? "旧形式の分析結果です。再分析すると新しい形式（実施手段・根拠プラクティス・期待効果・コピペ用スニペット付きアクション）で表示されます"
                  : "まだ実行されていません。「分析開始」を押すと優先課題をピックアップします"
              }
            />
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
                <div className="mt-2 space-y-2">
                  {issue.actions.map((action) => (
                    <div
                      key={action.title}
                      className="rounded-md border border-black/10 bg-black/[0.02] p-2 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={KIND_TONES[action.kind]}>{action.kind}</Badge>
                        <span className="text-sm font-medium">{action.title}</span>
                        <span className="text-xs text-black/40 dark:text-white/40">
                          根拠: {practiceNameOf(action.practice) ?? action.practice}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{action.how}</p>
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                        期待効果: {action.expectedEffect}
                      </p>
                      {action.snippet !== "" && (
                        <div className="relative mt-2">
                          <pre className="overflow-x-auto rounded bg-black/5 p-2 pr-24 text-xs dark:bg-white/10">
                            <code>{action.snippet}</code>
                          </pre>
                          <div className="absolute right-1 top-1">
                            <CopyButton text={action.snippet} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="border-t border-black/10 pt-2 text-xs text-black/50 dark:border-white/15 dark:text-white/50">
              {formatDateTimeJa(priority.analyzedAt)} 分析 ・{" "}
              {PROVIDER_LABELS[priority.provider ?? "claude"]} / {priority.model} ・
              対象{priority.analyzedSessionCount}件
              {priority.costUSD !== null && ` ・ ${formatUSD(priority.costUSD)}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
