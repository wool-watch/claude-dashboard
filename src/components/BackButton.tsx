"use client";

import { useRouter } from "next/navigation";

/** 履歴があれば戻り、直リンク・リロード直後は fallbackHref へ遷移する */
export function BackButton({
  fallbackHref,
  label = "戻る",
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="rounded-md border border-black/10 px-2 py-1 text-xs text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
    >
      ← {label}
    </button>
  );
}
