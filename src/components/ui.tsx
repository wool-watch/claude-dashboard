import type { ReactNode } from "react";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  /** 見出し行の右端に置く操作要素（ボタン等） */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const BADGE_TONES = {
  gray: "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70",
  amber:
    "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  purple:
    "bg-purple-500/15 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300",
  green:
    "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  blue: "bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
} as const;

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ message = "データがありません" }: { message?: string }) {
  return (
    <p className="py-8 text-center text-sm text-black/40 dark:text-white/40">
      {message}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      読み込みエラー: {message}
    </p>
  );
}

export function InfoNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
      {message}
    </p>
  );
}

export function Skeleton({ className = "h-32" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/10 ${className}`}
    />
  );
}
