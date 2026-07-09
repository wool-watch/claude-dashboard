// TZ=Asia/Tokyo で実行される前提
import { describe, expect, it } from "vitest";
import { aggregateWeekdayHourHeatmap } from "@/lib/aggregate/heatmap";
import { mkSession, mkTurn, usageOf } from "./helpers";

describe("aggregateWeekdayHourHeatmap", () => {
  it("空データは 7×24 の全ゼロ行列", () => {
    const cells = aggregateWeekdayHourHeatmap([], {});
    expect(cells).toHaveLength(7);
    for (const row of cells) {
      expect(row).toHaveLength(24);
      expect(row.every((v) => v === 0)).toBe(true);
    }
  });

  it("TZ跨ぎ: UTC 15:30 は JST 翌日 0:30 のセルに入る（行0=月曜）", () => {
    // 2026-07-05T15:30Z = JST 2026-07-06(月) 00:30 → cells[0][0]
    const s = mkSession("s1", [
      mkTurn("2026-07-05T15:30:00.000Z", { usage: usageOf(1000) }),
    ]);
    const cells = aggregateWeekdayHourHeatmap([s], {});
    expect(cells[0][0]).toBe(1000);
    expect(cells.flat().reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("曜日・時間帯への帰属（木曜14時 / 日曜12時）", () => {
    const s = mkSession("s1", [
      // 2026-07-09(木) JST 14:00 = UTC 05:00
      mkTurn("2026-07-09T05:00:00.000Z", { usage: usageOf(100) }),
      // 2026-07-05(日) JST 12:00 = UTC 03:00
      mkTurn("2026-07-05T03:00:00.000Z", { usage: usageOf(200) }),
    ]);
    const cells = aggregateWeekdayHourHeatmap([s], {});
    expect(cells[3][14]).toBe(100); // 木 = 行3
    expect(cells[6][12]).toBe(200); // 日 = 行6
  });

  it("同一セルは合算し、値は totalTokens（全種別合計）", () => {
    const s = mkSession("s1", [
      mkTurn("2026-07-09T05:00:00.000Z", {
        usage: { ...usageOf(100, 50), cacheReadTokens: 300 },
      }),
      mkTurn("2026-07-09T05:30:00.000Z", { usage: usageOf(1000) }),
    ]);
    const cells = aggregateWeekdayHourHeatmap([s], {});
    expect(cells[3][14]).toBe(450 + 1000);
  });

  it("project / 期間フィルタが効く", () => {
    const a = mkSession(
      "s1",
      [mkTurn("2026-07-09T05:00:00.000Z", { usage: usageOf(100) })],
      { projectId: "-a" },
    );
    const b = mkSession(
      "s2",
      [mkTurn("2026-07-09T05:00:00.000Z", { usage: usageOf(999) })],
      { projectId: "-b" },
    );
    const cells = aggregateWeekdayHourHeatmap([a, b], { projectId: "-a" });
    expect(cells[3][14]).toBe(100);

    const filtered = aggregateWeekdayHourHeatmap([a], {
      from: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(filtered.flat().reduce((x, y) => x + y, 0)).toBe(0);
  });
});
