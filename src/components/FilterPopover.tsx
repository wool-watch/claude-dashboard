"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * テーブル見出しに内蔵する絞り込みポップオーバー。
 * トリガー（じょうご型アイコン）をクリックすると小パネルを開き、
 * 外側クリック / Escape で閉じる。フィルタ適用中は `active` で強調する。
 */
export function FilterPopover({
  label,
  active,
  align = "right",
  children,
}: {
  /** aria-label 用の列名（例: "ソース"） */
  label: string;
  /** この列で絞り込みが有効か（アイコンを強調表示） */
  active: boolean;
  /** パネルの寄せ方向 */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // 外側クリック / Escape で閉じる（AnalysisStatusButton と同じ方式）
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

  return (
    <span ref={rootRef} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`${label}で絞り込み`}
        aria-expanded={open}
        // 見出しのクリック（ソート）に伝播させない
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`rounded p-0.5 leading-none transition-colors ${
          active
            ? "text-sky-600 dark:text-sky-400"
            : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden
        >
          <path d="M1 2h10l-4 4.5V11L5 9.5V6.5z" />
        </svg>
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-20 mt-1 min-w-44 rounded-md border border-black/10 bg-white p-2 text-left text-sm font-normal normal-case text-black/80 shadow-lg dark:border-white/15 dark:bg-neutral-900 dark:text-white/80 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </span>
  );
}
