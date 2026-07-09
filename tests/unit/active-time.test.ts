import { describe, expect, it } from "vitest";
import { estimateActiveTime } from "@/lib/domain/active-time";

const MIN = 60 * 1000;
const THRESHOLD = 5 * MIN;
const at = (offsetMs: number) => new Date(Date.UTC(2026, 6, 1) + offsetMs);

describe("estimateActiveTime", () => {
  it("空配列は 0", () => {
    expect(estimateActiveTime([], THRESHOLD)).toBe(0);
  });

  it("1件は 0", () => {
    expect(estimateActiveTime([at(0)], THRESHOLD)).toBe(0);
  });

  it("閾値以内のギャップは合算する", () => {
    // 0 → 1分 → 3分: ギャップ 1分 + 2分 = 3分
    expect(estimateActiveTime([at(0), at(MIN), at(3 * MIN)], THRESHOLD)).toBe(
      3 * MIN,
    );
  });

  it("閾値超過のギャップは不算入（離席扱い）", () => {
    // 0 → 1分 →(10分の離席)→ 11分 → 12分: 1分 + 1分 = 2分
    expect(
      estimateActiveTime(
        [at(0), at(MIN), at(11 * MIN), at(12 * MIN)],
        THRESHOLD,
      ),
    ).toBe(2 * MIN);
  });

  it("閾値ちょうどのギャップは算入する（境界）", () => {
    expect(estimateActiveTime([at(0), at(THRESHOLD)], THRESHOLD)).toBe(
      THRESHOLD,
    );
  });

  it("未ソート入力でも正しく計算する", () => {
    expect(estimateActiveTime([at(3 * MIN), at(0), at(MIN)], THRESHOLD)).toBe(
      3 * MIN,
    );
  });

  it("カスタム閾値を尊重する", () => {
    // 閾値90秒: 1分は算入、2分は不算入
    expect(
      estimateActiveTime([at(0), at(MIN), at(3 * MIN)], 90 * 1000),
    ).toBe(MIN);
  });

  it("不正な Date は除外する", () => {
    expect(
      estimateActiveTime([at(0), new Date("invalid"), at(MIN)], THRESHOLD),
    ).toBe(MIN);
  });
});
