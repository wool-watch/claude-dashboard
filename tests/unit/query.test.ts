// TZ=Asia/Tokyo で実行される前提
import { describe, expect, it } from "vitest";
import {
  ApiQueryError,
  parseDateRange,
  parseGranularity,
} from "@/lib/api/query";

const sp = (q: string) => new URLSearchParams(q);

describe("parseGranularity", () => {
  it("未指定は day", () => {
    expect(parseGranularity(sp(""))).toBe("day");
  });

  it.each(["hour", "day", "week", "month"] as const)("%s を受理する", (g) => {
    expect(parseGranularity(sp(`granularity=${g}`))).toBe(g);
  });

  it("不正値は ApiQueryError", () => {
    expect(() => parseGranularity(sp("granularity=minute"))).toThrow(
      ApiQueryError,
    );
  });
});

describe("parseDateRange", () => {
  it("未指定は空オブジェクト", () => {
    expect(parseDateRange(sp(""))).toEqual({});
  });

  it("日付のみの from はローカルTZの 00:00", () => {
    const { from } = parseDateRange(sp("from=2026-07-05"));
    expect(from).toEqual(new Date(2026, 6, 5)); // JST 7/5 00:00
  });

  it("日付のみの to は翌日 00:00（その日の終わりまでを含む排他上限）", () => {
    const { to } = parseDateRange(sp("to=2026-07-05"));
    expect(to).toEqual(new Date(2026, 6, 6));
  });

  it("ISO8601 日時はそのまま解釈する", () => {
    const { from, to } = parseDateRange(
      sp("from=2026-07-05T01:30:00.000Z&to=2026-07-06T02:00:00.000Z"),
    );
    expect(from?.toISOString()).toBe("2026-07-05T01:30:00.000Z");
    expect(to?.toISOString()).toBe("2026-07-06T02:00:00.000Z");
  });

  it("不正な日付は ApiQueryError", () => {
    expect(() => parseDateRange(sp("from=abc"))).toThrow(ApiQueryError);
    expect(() => parseDateRange(sp("to=2026-13-99"))).toThrow(ApiQueryError);
  });
});
