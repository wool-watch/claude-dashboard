import { type AggregateFilter, filterTurns } from "@/lib/aggregate/filter";
import { calculateCost } from "@/lib/pricing/cost";
import {
  addUsage,
  emptyUsage,
  type ModelStats,
  type SessionDetail,
  type UsageTotals,
} from "@/lib/types";

export function aggregateModels(
  sessions: SessionDetail[],
  filter: AggregateFilter,
): ModelStats[] {
  const usageByModel = new Map<
    string,
    { usage: UsageTotals; requestCount: number }
  >();

  for (const { turn } of filterTurns(sessions, filter)) {
    for (const [model, usage] of Object.entries(turn.perModelUsage)) {
      const entry = usageByModel.get(model) ?? {
        usage: emptyUsage(),
        requestCount: 0,
      };
      entry.usage = addUsage(entry.usage, usage);
      entry.requestCount += turn.perModelRequests[model] ?? 0;
      usageByModel.set(model, entry);
    }
  }

  const stats: ModelStats[] = [];
  for (const [model, { usage, requestCount }] of usageByModel) {
    const { costUSD, isEstimated } = calculateCost(usage, model);
    stats.push({ model, usage, costUSD, requestCount, isEstimated });
  }
  return stats.sort((a, b) => b.costUSD - a.costUSD);
}
