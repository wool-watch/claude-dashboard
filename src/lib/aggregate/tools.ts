import { type AggregateFilter, filterTurns } from "@/lib/aggregate/filter";
import type { SessionDetail, ToolStats } from "@/lib/types";

export function aggregateTools(
  sessions: SessionDetail[],
  filter: AggregateFilter,
): ToolStats[] {
  const counts = new Map<string, number>();
  for (const { turn } of filterTurns(sessions, filter)) {
    for (const [tool, count] of Object.entries(turn.toolCounts)) {
      counts.set(tool, (counts.get(tool) ?? 0) + count);
    }
  }
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}
