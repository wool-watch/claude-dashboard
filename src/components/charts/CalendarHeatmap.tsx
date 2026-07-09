"use client";

import {
  heatLevel,
  monthLabels,
  toCalendarWeeks,
  trimLeadingEmptyWeeks,
} from "@/components/charts/heatmap-transform";
import { HEAT_LEVEL_CLASSES } from "@/components/charts/theme";
import { formatTokens } from "@/components/format";
import { EmptyState } from "@/components/ui";
import type { TimeBucket } from "@/lib/types";

const WEEK_COL_PX = 14; // セル12px + 間隔2px
const ROW_LABELS: Array<[row: number, label: string]> = [
  [0, "月"],
  [2, "水"],
  [4, "金"],
  [6, "日"],
];

function HeatLegend() {
  return (
    <div className="mt-2 flex items-center gap-1 text-[10px] text-black/50 dark:text-white/50">
      少
      {HEAT_LEVEL_CLASSES.map((cls) => (
        <span key={cls} className={`h-3 w-3 rounded-[2px] ${cls}`} />
      ))}
      多
    </div>
  );
}

export function CalendarHeatmap({ buckets }: { buckets: TimeBucket[] }) {
  // データのある最初の週から表示（先頭の空期間はグリッドに出さない）
  const weeks = trimLeadingEmptyWeeks(toCalendarWeeks(buckets));
  const max = Math.max(
    0,
    ...weeks.flat().map((c) => (c === null ? 0 : c.tokens)),
  );
  if (weeks.length === 0 || max === 0) {
    return <EmptyState message="この期間のデータがありません" />;
  }
  const labels = monthLabels(weeks);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="relative ml-6 h-4">
          {labels.map((l) => (
            <span
              key={`${l.index}-${l.label}`}
              className="absolute whitespace-nowrap text-[10px] text-black/50 dark:text-white/50"
              style={{ left: l.index * WEEK_COL_PX }}
            >
              {l.label}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <div className="relative w-5">
            {ROW_LABELS.map(([row, label]) => (
              <span
                key={label}
                className="absolute text-[10px] leading-3 text-black/50 dark:text-white/50"
                style={{ top: row * WEEK_COL_PX }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-[2px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[2px]">
                {week.map((cell, di) =>
                  cell === null ? (
                    <span key={di} className="h-3 w-3" />
                  ) : (
                    <span
                      key={cell.date}
                      title={`${Number(cell.date.split("-")[1])}/${Number(cell.date.split("-")[2])}: ${formatTokens(cell.tokens)} tokens`}
                      className={`h-3 w-3 rounded-[2px] ${HEAT_LEVEL_CLASSES[heatLevel(cell.tokens, max)]}`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <HeatLegend />
      </div>
    </div>
  );
}
