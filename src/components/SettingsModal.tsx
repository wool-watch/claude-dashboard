"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_LABELS } from "@/lib/analysis/provider-labels";
import type { ProviderId, RetentionDays } from "@/lib/settings/settings";

type AnalysisModel = "haiku" | "sonnet";

/** GET /api/settings が返す公開形（apiKey は hasApiKey に変換済み） */
interface PublicSettings {
  retentionDays: RetentionDays;
  analysisProvider: ProviderId;
  providers: {
    claude: { model: AnalysisModel; cliPath: string };
    codex: { model: string; cliPath: string };
    gemini: { model: string; cliPath: string };
    lmstudio: { model: string; baseUrl: string };
    openaiCompatible: { model: string; baseUrl: string; hasApiKey: boolean };
  };
}

const RETENTION_OPTIONS: readonly RetentionDays[] = [30, 90, 120, 150, 180, null];

const retentionLabel = (v: RetentionDays) => (v === null ? "無制限" : `${v}日`);

const PROVIDER_OPTIONS: ReadonlyArray<{ value: ProviderId; note: string }> = [
  { value: "claude", note: "claude コマンド（既定）" },
  { value: "codex", note: "codex exec で実行" },
  { value: "gemini", note: "gemini コマンドで実行" },
  { value: "lmstudio", note: "ローカルサーバー（OpenAI互換API）" },
  { value: "openaiCompatible", note: "Ollama / vLLM など任意の互換API" },
];

const CLAUDE_MODEL_OPTIONS: ReadonlyArray<{ value: AnalysisModel; label: string }> = [
  { value: "haiku", label: "haiku（高速・低コスト）" },
  { value: "sonnet", label: "sonnet（高精度）" },
];

/** プロバイダ別フォームのテキスト入力フィールド定義 */
const PROVIDER_FIELDS: Record<
  ProviderId,
  ReadonlyArray<{ key: string; label: string; placeholder: string; password?: boolean }>
> = {
  claude: [
    { key: "cliPath", label: "CLIパス", placeholder: "空欄で claude（CLAUDE_CLI_PATH）" },
  ],
  codex: [
    { key: "model", label: "モデル", placeholder: "例: gpt-5-codex" },
    { key: "cliPath", label: "CLIパス", placeholder: "例: codex" },
  ],
  gemini: [
    { key: "model", label: "モデル", placeholder: "例: gemini-2.5-flash" },
    { key: "cliPath", label: "CLIパス", placeholder: "例: gemini" },
  ],
  lmstudio: [
    { key: "baseUrl", label: "Base URL", placeholder: "http://localhost:1234/v1" },
    { key: "model", label: "モデル", placeholder: "ロード済みモデル名" },
  ],
  openaiCompatible: [
    { key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434/v1" },
    { key: "model", label: "モデル", placeholder: "例: llama3" },
    { key: "apiKey", label: "APIキー", placeholder: "不要なら空欄", password: true },
  ],
};

export function SettingsModal({
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
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // オープン時に現在値を取得
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/settings", { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSettings((await res.json()) as PublicSettings);
        setError(null);
      } catch {
        if (!controller.signal.aborted) setError("設定の取得に失敗しました");
      }
    })();
    return () => controller.abort();
  }, []);

  // Escape で閉じる
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const provider = settings?.analysisProvider ?? "claude";

  // プロバイダ切替・取得時にフォームの下書きを現在値から初期化（apiKey は常に空欄）
  useEffect(() => {
    if (settings === null) return;
    const current = settings.providers[settings.analysisProvider] as unknown as Record<
      string,
      unknown
    >;
    const next: Record<string, string> = {};
    for (const field of PROVIDER_FIELDS[settings.analysisProvider]) {
      const value = current[field.key];
      next[field.key] = typeof value === "string" ? value : "";
    }
    setDraft(next);
  }, [settings]);

  /** 部分更新 PUT。成功時はサーバーが返す公開設定で state を同期する */
  const put = useCallback(async (patch: Record<string, unknown>): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSettings((await res.json()) as PublicSettings);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定の保存に失敗しました");
      return false;
    }
  }, []);

  const saveProviderForm = useCallback(async () => {
    if (settings === null) return;
    setSaving(true);
    const patch: Record<string, string> = {};
    for (const field of PROVIDER_FIELDS[provider]) {
      // apiKey は空欄 = 変更なし（サーバー側仕様）なのでそのまま送ってよい
      patch[field.key] = draft[field.key] ?? "";
    }
    const ok = await put({ providers: { [provider]: patch } });
    setSaving(false);
    if (ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    }
  }, [settings, provider, draft, put]);

  const inputClass =
    "w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15";
  const sectionTitleClass = "mb-2 text-xs font-semibold";
  const helpClass = "mt-1 text-[10px] text-black/50 dark:text-white/50";

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
        aria-label="設定"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-black/10 bg-white p-4 shadow-xl dark:border-white/15 dark:bg-neutral-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded px-2 py-1 text-sm text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        {settings === null ? (
          <p className="py-8 text-center text-xs text-black/50 dark:text-white/50">
            {error ?? "読み込み中…"}
          </p>
        ) : (
          <div className="space-y-4">
            <section>
              <p className={sectionTitleClass}>アーカイブ保持期間</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {RETENTION_OPTIONS.map((option) => (
                  <label
                    key={String(option)}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <input
                      type="radio"
                      name="retention"
                      checked={settings.retentionDays === option}
                      onChange={() => void put({ retentionDays: option })}
                    />
                    {retentionLabel(option)}
                  </label>
                ))}
              </div>
              <p className={helpClass}>
                保持期間より古いアーカイブは次回同期時に削除されます
              </p>
            </section>

            <section className="border-t border-black/10 pt-3 dark:border-white/15">
              <p className={sectionTitleClass}>AI分析プロバイダ</p>
              <div className="flex flex-col gap-1">
                {PROVIDER_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <input
                      type="radio"
                      name="analysisProvider"
                      checked={provider === option.value}
                      onChange={() =>
                        void put({ analysisProvider: option.value })
                      }
                    />
                    <span>{PROVIDER_LABELS[option.value]}</span>
                    <span className="text-[10px] text-black/40 dark:text-white/40">
                      {option.note}
                    </span>
                  </label>
                ))}
              </div>
              <p className={helpClass}>
                セッションのAI振り返り・優先課題分析に使うバックエンド。プロバイダごとの設定は切り替えても保持されます
              </p>
            </section>

            <section className="rounded-md border border-black/10 p-3 dark:border-white/15">
              <p className={sectionTitleClass}>
                {PROVIDER_LABELS[provider]} の設定
              </p>

              {provider === "claude" && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] text-black/50 dark:text-white/50">
                    モデル
                  </p>
                  <div className="flex flex-col gap-1">
                    {CLAUDE_MODEL_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <input
                          type="radio"
                          name="claudeModel"
                          checked={settings.providers.claude.model === option.value}
                          onChange={() =>
                            void put({
                              providers: { claude: { model: option.value } },
                            })
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {PROVIDER_FIELDS[provider].map((field) => (
                  <div key={field.key}>
                    <label className="mb-0.5 block text-[10px] text-black/50 dark:text-white/50">
                      {field.label}
                      {field.key === "apiKey" &&
                        settings.providers.openaiCompatible.hasApiKey && (
                          <span className="ml-1 text-emerald-700 dark:text-emerald-300">
                            設定済み（変更する場合のみ入力）
                          </span>
                        )}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type={field.password === true ? "password" : "text"}
                        value={draft[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [field.key]: e.target.value }))
                        }
                        className={inputClass}
                      />
                      {field.key === "apiKey" &&
                        settings.providers.openaiCompatible.hasApiKey && (
                          <button
                            type="button"
                            onClick={() =>
                              void put({
                                providers: { openaiCompatible: { apiKey: null } },
                              })
                            }
                            className="shrink-0 rounded-md border border-black/10 px-2 py-1 text-[10px] text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
                          >
                            クリア
                          </button>
                        )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveProviderForm()}
                  disabled={saving}
                  className="rounded-md border border-black/10 px-3 py-1 text-xs text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/10"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
                {savedAt !== null && (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
                    保存しました
                  </span>
                )}
              </div>
              {provider === "openaiCompatible" && (
                <p className={helpClass}>
                  APIキーは設定ファイル（settings.json、パーミッション600）に保存されます。環境変数
                  OPENAI_COMPAT_API_KEY があればそちらが優先されます
                </p>
              )}
            </section>

            {error !== null && (
              <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
