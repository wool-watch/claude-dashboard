import { type TimeBucket, totalTokens } from "@/lib/types";

export interface CalendarCell {
  date: string; // "yyyy-MM-dd"
  tokens: number;
}

export type CalendarWeek = Array<CalendarCell | null>;

/**
 * 日次バケット列を週単位（月曜始まり・各7要素）に分割する。
 * 週の途中から始まる/終わる場合は null で埋める。
 */
export function toCalendarWeeks(buckets: TimeBucket[]): CalendarWeek[] {
  const weeks: CalendarWeek[] = [];
  let week: CalendarWeek | null = null;

  for (const b of buckets) {
    const date = b.bucketStart.split("T")[0];
    const [y, m, d] = date.split("-").map(Number);
    const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7; // 月曜=0
    if (week === null || weekday === 0) {
      week = new Array<CalendarCell | null>(7).fill(null);
      weeks.push(week);
    }
    week[weekday] = { date, tokens: totalTokens(b.usage) };
  }
  return weeks;
}

/**
 * 5段階の色レベル。トークン量は日によって桁が変わるため
 * sqrt スケールで少量日も視認できるようにする。
 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const level = Math.ceil(Math.sqrt(Math.min(value / max, 1)) * 4);
  return Math.min(Math.max(level, 1), 4) as 1 | 2 | 3 | 4;
}

/**
 * 先頭の空週（全セルが null または tokens=0）を除去し、
 * 最初にデータのある週から表示できるようにする。全週空なら []。
 */
export function trimLeadingEmptyWeeks(weeks: CalendarWeek[]): CalendarWeek[] {
  const firstIndex = weeks.findIndex((week) =>
    week.some((c) => c !== null && c.tokens > 0),
  );
  return firstIndex === -1 ? [] : weeks.slice(firstIndex);
}

/** 先頭週と月替わりの週に付ける「7月」等のラベル */
export function monthLabels(
  weeks: CalendarWeek[],
): Array<{ index: number; label: string }> {
  const labels: Array<{ index: number; label: string }> = [];
  let prevMonth: number | null = null;

  weeks.forEach((week, index) => {
    const first = week.find((c) => c !== null);
    if (first === undefined || first === null) return;
    const month = Number(first.date.split("-")[1]);
    if (month !== prevMonth) {
      labels.push({ index, label: `${month}月` });
      prevMonth = month;
    }
  });
  return labels;
}
