import type { SessionDetail, Turn } from "@/lib/types";

export interface AggregateFilter {
  /** turn.startedAt 基準の閉区間下限 */
  from?: Date;
  /** turn.startedAt 基準の排他上限 */
  to?: Date;
  projectId?: string;
}

export function filterTurns(
  sessions: SessionDetail[],
  f: AggregateFilter,
): Array<{ session: SessionDetail; turn: Turn }> {
  const fromMs = f.from?.getTime();
  const toMs = f.to?.getTime();
  const out: Array<{ session: SessionDetail; turn: Turn }> = [];

  for (const session of sessions) {
    if (f.projectId !== undefined && session.projectId !== f.projectId)
      continue;
    for (const turn of session.turns) {
      const ms = new Date(turn.startedAt).getTime();
      if (!Number.isFinite(ms)) continue;
      if (fromMs !== undefined && ms < fromMs) continue;
      if (toMs !== undefined && ms >= toMs) continue;
      out.push({ session, turn });
    }
  }
  return out;
}
