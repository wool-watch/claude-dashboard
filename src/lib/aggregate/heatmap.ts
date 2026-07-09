import { type AggregateFilter, filterTurns } from "@/lib/aggregate/filter";
import { type SessionDetail, totalTokens } from "@/lib/types";

/**
 * 曜日×時間帯のトークン数ヒートマップ（7行×24列、行0=月曜）。
 * turn.startedAt をローカルTZで振り分ける。
 */
export function aggregateWeekdayHourHeatmap(
  sessions: SessionDetail[],
  filter: AggregateFilter,
): number[][] {
  const cells: number[][] = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0),
  );
  for (const { turn } of filterTurns(sessions, filter)) {
    const d = new Date(turn.startedAt);
    const weekday = (d.getDay() + 6) % 7; // 月曜=0
    cells[weekday][d.getHours()] += totalTokens(turn.usage);
  }
  return cells;
}
