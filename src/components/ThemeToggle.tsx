"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABELS: Record<Theme, string> = {
  system: "自動",
  light: "ライト",
  dark: "ダーク",
};

/** localStorage の変更を購読者へ通知するための同一タブ内イベント */
const THEME_EVENT = "claude-dashboard-theme-change";

function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  if (theme === "system") localStorage.removeItem("theme");
  else localStorage.setItem("theme", theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange); // 別タブでの変更にも追従
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getTheme(): Theme {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function ThemeToggle() {
  // SSR/ハイドレーション時は "system"、マウント後に localStorage の値へ同期される
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    getTheme,
    () => "system",
  );

  // 「自動」選択中は OS 設定の変更に追従する
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
        applyTheme(next);
      }}
      title="テーマ切替（自動 → ライト → ダーク）"
      className="rounded-md border border-black/10 px-2 py-1 text-xs text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
    >
      {LABELS[theme]}
    </button>
  );
}
