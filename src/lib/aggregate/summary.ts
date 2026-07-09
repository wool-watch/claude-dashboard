import { startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { filterTurns } from "@/lib/aggregate/filter";
import {
  addUsage,
  type ApiSummary,
  emptyUsage,
  type PeriodStats,
  type SessionDetail,
  totalTokens,
} from "@/lib/types";

function periodStats(sessions: SessionDetail[], from?: Date): PeriodStats {
  let usage = emptyUsage();
  let costUSD = 0;
  let turnCount = 0;
  let activeTimeMs = 0;
  const sessionIds = new Set<string>();

  for (const { session, turn } of filterTurns(sessions, { from })) {
    usage = addUsage(usage, turn.usage);
    costUSD += turn.costUSD;
    turnCount += 1;
    activeTimeMs += turn.activeTimeMs;
    sessionIds.add(session.sessionId);
  }

  return {
    costUSD,
    totalTokens: totalTokens(usage),
    usage,
    sessionCount: sessionIds.size,
    turnCount,
    activeTimeMs,
  };
}

export function buildSummary(
  sessions: SessionDetail[],
  now: Date = new Date(),
): ApiSummary {
  return {
    totals: periodStats(sessions),
    today: periodStats(sessions, startOfDay(now)),
    thisWeek: periodStats(sessions, startOfWeek(now, { weekStartsOn: 1 })),
    thisMonth: periodStats(sessions, startOfMonth(now)),
    costIsEstimated: sessions.some((s) => s.costIsEstimated),
    generatedAt: now.toISOString(),
  };
}
