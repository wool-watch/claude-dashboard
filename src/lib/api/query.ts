import { addDays } from "date-fns";
import type { Granularity } from "@/lib/types";

/** クエリ不正を表す。ハンドラ側で 400 に変換する */
export class ApiQueryError extends Error {}

const GRANULARITIES = ["hour", "day", "week", "month"] as const;

export function parseGranularity(sp: URLSearchParams): Granularity {
  const raw = sp.get("granularity");
  if (raw === null) return "day";
  if ((GRANULARITIES as readonly string[]).includes(raw)) {
    return raw as Granularity;
  }
  throw new ApiQueryError(`invalid granularity: ${raw}`);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(raw: string, endOfDayExclusive: boolean): Date {
  const m = DATE_ONLY_RE.exec(raw);
  if (m !== null) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d); // ローカルTZの 00:00
    // JS Date は 13月99日等を繰り上げてしまうため成分を再検証する
    if (
      date.getFullYear() !== y ||
      date.getMonth() !== mo - 1 ||
      date.getDate() !== d
    ) {
      throw new ApiQueryError(`invalid date: ${raw}`);
    }
    // 日付のみの to は「その日の終わりまで」= 翌日 00:00 を排他上限にする
    return endOfDayExclusive ? addDays(date, 1) : date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ApiQueryError(`invalid date: ${raw}`);
  }
  return date;
}

export function parseDateRange(sp: URLSearchParams): {
  from?: Date;
  to?: Date;
} {
  const out: { from?: Date; to?: Date } = {};
  const from = sp.get("from");
  const to = sp.get("to");
  if (from !== null) out.from = parseDate(from, false);
  if (to !== null) out.to = parseDate(to, true);
  return out;
}
