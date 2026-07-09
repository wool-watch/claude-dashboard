"use client";

import { heatLevel } from "@/components/charts/heatmap-transform";
import { HEAT_LEVEL_CLASSES } from "@/components/charts/theme";
import { formatTokens } from "@/components/format";
import { EmptyState } from "@/components/ui";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;
const HOUR_LABELS = [0, 6, 12, 18];

export function WeekdayHourHeatmap({ cells }: { cells: number[][] }) {
  const max = Math.max(0, ...cells.flat());
  if (max === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="ml-7 flex gap-[2px] text-[10px] text-black/50 dark:text-white/50">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="w-4 text-center">
              {HOUR_LABELS.includes(h) ? `${h}` : ""}
            </span>
          ))}
        </div>
        {cells.map((row, weekday) => (
          <div key={WEEKDAYS[weekday]} className="mt-[2px] flex items-center gap-[2px]">
            <span className="w-6 text-[10px] text-black/50 dark:text-white/50">
              {WEEKDAYS[weekday]}
            </span>
            {row.map((value, hour) => (
              <span
                key={hour}
                title={`${WEEKDAYS[weekday]} ${hour}時: ${formatTokens(value)} tokens`}
                className={`h-4 w-4 rounded-[2px] ${HEAT_LEVEL_CLASSES[heatLevel(value, max)]}`}
              />
            ))}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-black/50 dark:text-white/50">
          少
          {HEAT_LEVEL_CLASSES.map((cls) => (
            <span key={cls} className={`h-3 w-3 rounded-[2px] ${cls}`} />
          ))}
          多
        </div>
      </div>
    </div>
  );
}
