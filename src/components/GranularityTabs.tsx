"use client";

import type { Granularity } from "@/lib/types";

const LABELS: Record<Granularity, string> = {
  hour: "時間",
  day: "日",
  week: "週",
  month: "月",
};

export function GranularityTabs({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-black/10 text-sm dark:border-white/15">
      {(Object.keys(LABELS) as Granularity[]).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className={`px-3 py-1 first:rounded-l-md last:rounded-r-md ${
            g === value
              ? "bg-black/80 text-white dark:bg-white/90 dark:text-black"
              : "text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
          }`}
        >
          {LABELS[g]}
        </button>
      ))}
    </div>
  );
}
