import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  format,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
  subDays,
  subHours,
  subMonths,
  subWeeks,
} from "date-fns";
import { type AggregateFilter, filterTurns } from "@/lib/aggregate/filter";
import {
  addUsage,
  emptyUsage,
  type Granularity,
  type SessionDetail,
  type TimeBucket,
} from "@/lib/types";

const WEEK_OPTS = { weekStartsOn: 1 as const };

function bucketStart(d: Date, g: Granularity): Date {
  switch (g) {
    case "hour":
      return startOfHour(d);
    case "day":
      return startOfDay(d);
    case "week":
      return startOfWeek(d, WEEK_OPTS);
    case "month":
      return startOfMonth(d);
  }
}

function nextBucket(d: Date, g: Granularity): Date {
  switch (g) {
    case "hour":
      return addHours(d, 1);
    case "day":
      return addDays(d, 1);
    case "week":
      return addWeeks(d, 1);
    case "month":
      return addMonths(d, 1);
  }
}

/** hour=48時間 / day=30日 / week=26週 / month=12ヶ月 */
function defaultFrom(now: Date, g: Granularity): Date {
  switch (g) {
    case "hour":
      return subHours(now, 47);
    case "day":
      return subDays(now, 29);
    case "week":
      return subWeeks(now, 25);
    case "month":
      return subMonths(now, 11);
  }
}

const keyOf = (d: Date): string => format(d, "yyyy-MM-dd'T'HH:mm");

const emptyBucket = (key: string): TimeBucket => ({
  bucketStart: key,
  usage: emptyUsage(),
  costUSD: 0,
  messageCount: 0,
  turnCount: 0,
  activeTimeMs: 0,
  sessionCount: 0,
});

/**
 * ターン単位でローカルTZのバケットに帰属させる。
 * 範囲内の空バケットは0埋めして返す。
 */
export function bucketize(
  sessions: SessionDetail[],
  granularity: Granularity,
  filter: AggregateFilter,
  now: Date = new Date(),
): TimeBucket[] {
  const from = filter.from ?? defaultFrom(now, granularity);
  // デフォルト上限は now を含める（now がバケット境界ちょうどでも現在バケットを生成する）
  const to = filter.to ?? new Date(now.getTime() + 1);

  const buckets = new Map<string, TimeBucket>();
  const bucketSessions = new Map<string, Set<string>>();
  for (
    let cursor = bucketStart(from, granularity);
    cursor < to;
    cursor = nextBucket(cursor, granularity)
  ) {
    const key = keyOf(cursor);
    buckets.set(key, emptyBucket(key));
    bucketSessions.set(key, new Set());
  }

  for (const { session, turn } of filterTurns(sessions, {
    ...filter,
    from,
    to,
  })) {
    const key = keyOf(bucketStart(new Date(turn.startedAt), granularity));
    const bucket = buckets.get(key);
    if (bucket === undefined) continue;
    bucket.usage = addUsage(bucket.usage, turn.usage);
    bucket.costUSD += turn.costUSD;
    bucket.messageCount += turn.assistantMessageCount + 1;
    bucket.turnCount += 1;
    bucket.activeTimeMs += turn.activeTimeMs;
    bucketSessions.get(key)?.add(session.sessionId);
  }

  for (const [key, ids] of bucketSessions) {
    const bucket = buckets.get(key);
    if (bucket !== undefined) bucket.sessionCount = ids.size;
  }

  return [...buckets.values()];
}
