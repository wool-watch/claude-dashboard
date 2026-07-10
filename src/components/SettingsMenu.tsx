"use client";

import { useEffect, useRef, useState } from "react";

type RetentionDays = 30 | 90 | 120 | 150 | 180 | null;

const RETENTION_OPTIONS: readonly RetentionDays[] = [
  30, 90, 120, 150, 180, null,
];

const label = (v: RetentionDays) => (v === null ? "無制限" : `${v}日`);

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [retention, setRetention] = useState<RetentionDays>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 開いたときに現在値を取得する
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/settings", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { retentionDays: RetentionDays };
        setRetention(body.retentionDays);
        setError(null);
      } catch {
        if (!controller.signal.aborted) {
          setError("設定の取得に失敗しました");
        }
      }
    })();
    return () => controller.abort();
  }, [open]);

  // 外側クリック / Escape で閉じる
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

  const select = async (value: RetentionDays) => {
    const prev = retention;
    setRetention(value); // 楽観更新
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setRetention(prev);
      setError("設定の保存に失敗しました");
    }
  };

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="設定"
        aria-label="設定"
        aria-expanded={open}
        className="rounded-md border border-black/10 px-2 py-1 text-xs text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-md border border-black/10 bg-white p-3 shadow-lg dark:border-white/15 dark:bg-neutral-900">
          <p className="mb-2 text-xs font-semibold">アーカイブ保持期間</p>
          <div className="flex flex-col gap-1">
            {RETENTION_OPTIONS.map((option) => (
              <label
                key={String(option)}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
              >
                <input
                  type="radio"
                  name="retention"
                  checked={retention === option}
                  onChange={() => void select(option)}
                />
                {label(option)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-black/50 dark:text-white/50">
            保持期間より古いアーカイブは次回同期時に削除されます
          </p>
          {error !== null && (
            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
