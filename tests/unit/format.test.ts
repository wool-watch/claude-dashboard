// TZ=Asia/Tokyo で実行される前提
import { describe, expect, it } from "vitest";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";

describe("formatTokens", () => {
  it("1000未満はそのまま", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("k 表記（小数1桁）", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(999_949)).toBe("999.9k");
  });

  it("M 表記（小数1桁）", () => {
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(259_747_455)).toBe("259.7M");
    // 999,950 は k だと "1000.0k" になるため M に切替える
    expect(formatTokens(999_950)).toBe("1.0M");
  });
});

describe("formatUSD", () => {
  it("0 は $0.00", () => {
    expect(formatUSD(0)).toBe("$0.00");
  });

  it("$1未満は4桁", () => {
    expect(formatUSD(0.01234)).toBe("$0.0123");
    expect(formatUSD(0.5)).toBe("$0.5000");
  });

  it("$1以上は2桁", () => {
    expect(formatUSD(1)).toBe("$1.00");
    expect(formatUSD(12.345)).toBe("$12.35");
    // 264.025 は二進表現が 264.0249… のため toFixed で切下がる（JSの仕様どおり）
    expect(formatUSD(264.025)).toBe("$264.02");
  });
});

describe("formatDurationJa", () => {
  it("秒", () => {
    expect(formatDurationJa(0)).toBe("0秒");
    expect(formatDurationJa(45_000)).toBe("45秒");
    expect(formatDurationJa(59_999)).toBe("59秒");
  });

  it("分", () => {
    expect(formatDurationJa(60_000)).toBe("1分");
    expect(formatDurationJa(12 * 60_000)).toBe("12分");
  });

  it("時間+分（分が0なら省略）", () => {
    expect(formatDurationJa(3_600_000)).toBe("1時間");
    expect(formatDurationJa(4_980_000)).toBe("1時間23分");
  });

  it("日+時間（時間が0なら省略）", () => {
    expect(formatDurationJa(86_400_000)).toBe("1日");
    expect(formatDurationJa(2 * 86_400_000 + 4 * 3_600_000)).toBe("2日4時間");
  });
});

describe("formatDateTimeJa", () => {
  it("ローカルTZ（JST）で M/d HH:mm", () => {
    expect(formatDateTimeJa("2026-07-06T07:28:29.901Z")).toBe("7/6 16:28");
  });

  it("不正な日時はそのまま返す", () => {
    expect(formatDateTimeJa("")).toBe("");
  });
});
