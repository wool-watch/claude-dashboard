import { describe, expect, it } from "vitest";
import { calculateCost } from "@/lib/pricing/cost";
import { resolvePricing } from "@/lib/pricing/model-pricing";
import { emptyUsage, type UsageTotals } from "@/lib/types";

/** 全フィールド 1M tokens → コスト = 単価表の行合計（USD/1M なのでそのまま読める） */
const MILLION: UsageTotals = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheWrite5mTokens: 1_000_000,
  cacheWrite1hTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
};

describe("calculateCost: 既知モデルの単価（isEstimated=false）", () => {
  // 期待値 = input + output + w5m + w1h + read の単価合計
  const cases: Array<[model: string, expected: number]> = [
    ["claude-fable-5", 10 + 50 + 12.5 + 20 + 1], // 93.5
    ["claude-opus-4-8", 5 + 25 + 6.25 + 10 + 0.5], // 46.75
    ["claude-opus-4-7", 46.75],
    ["claude-opus-4-6", 46.75],
    ["claude-opus-4-5", 46.75],
    ["claude-opus-4-1", 15 + 75 + 18.75 + 30 + 1.5], // 140.25
    ["claude-opus-4-0", 140.25],
    ["claude-sonnet-4-6", 3 + 15 + 3.75 + 6 + 0.3], // 28.05
    ["claude-sonnet-4-5", 28.05],
    ["claude-sonnet-4-0", 28.05],
    ["claude-haiku-4-5", 1 + 5 + 1.25 + 2 + 0.1], // 9.35
    ["claude-3-5-haiku", 0.8 + 4 + 1 + 1.6 + 0.08], // 7.48
  ];

  it.each(cases)("%s: 1M×全フィールド = $%f", (model, expected) => {
    const r = calculateCost(MILLION, model);
    expect(r.costUSD).toBeCloseTo(expected, 6);
    expect(r.isEstimated).toBe(false);
  });

  it("日付サフィックス付きモデルIDも前方一致で解決する", () => {
    const r = calculateCost(MILLION, "claude-haiku-4-5-20251001");
    expect(r.costUSD).toBeCloseTo(9.35, 6);
    expect(r.isEstimated).toBe(false);
  });

  it("フィールド別の単価が正しい（claude-opus-4-8）", () => {
    const base = emptyUsage();
    expect(
      calculateCost({ ...base, inputTokens: 1000 }, "claude-opus-4-8").costUSD,
    ).toBeCloseTo(0.005, 9);
    expect(
      calculateCost({ ...base, outputTokens: 1000 }, "claude-opus-4-8").costUSD,
    ).toBeCloseTo(0.025, 9);
    expect(
      calculateCost({ ...base, cacheWrite5mTokens: 2000 }, "claude-opus-4-8")
        .costUSD,
    ).toBeCloseTo(0.0125, 9);
    expect(
      calculateCost({ ...base, cacheWrite1hTokens: 1000 }, "claude-opus-4-8")
        .costUSD,
    ).toBeCloseTo(0.01, 9);
    expect(
      calculateCost({ ...base, cacheReadTokens: 3000 }, "claude-opus-4-8")
        .costUSD,
    ).toBeCloseTo(0.0015, 9);
  });

  it("basic-session fixture の合成ケース（設計書§11.2 の手計算値）", () => {
    // (3000×5 + 1500×25 + 2000×6.25 + 3000×0.5) / 1e6
    // = (15000 + 37500 + 12500 + 1500) / 1e6 = 0.0665
    const usage: UsageTotals = {
      inputTokens: 3000,
      outputTokens: 1500,
      cacheWrite5mTokens: 2000,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 3000,
    };
    expect(calculateCost(usage, "claude-opus-4-8").costUSD).toBeCloseTo(
      0.0665,
      9,
    );
  });
});

describe("calculateCost: 未知モデルの階層フォールバック（isEstimated=true）", () => {
  const cases: Array<[model: string, expected: number]> = [
    ["claude-fable-9", 93.5], // "fable" 部分一致
    ["claude-opus-5", 46.75], // "opus" → Opus現行(4-8系)
    ["claude-sonnet-9", 28.05], // "sonnet" 部分一致
    ["claude-haiku-9", 9.35], // "haiku" → Haiku 4.5
    ["claude-test-99", 46.75], // 全不一致 → Opus現行
  ];

  it.each(cases)("%s → $%f（推定）", (model, expected) => {
    const r = calculateCost(MILLION, model);
    expect(r.costUSD).toBeCloseTo(expected, 6);
    expect(r.isEstimated).toBe(true);
  });

  it("部分一致は大文字小文字を無視する", () => {
    const r = calculateCost(MILLION, "Claude-Sonnet-Experimental");
    expect(r.costUSD).toBeCloseTo(28.05, 6);
    expect(r.isEstimated).toBe(true);
  });
});

describe("calculateCost: 特殊モデル", () => {
  it("<synthetic> は $0 で isEstimated=false（$0確定）", () => {
    const r = calculateCost(MILLION, "<synthetic>");
    expect(r.costUSD).toBe(0);
    expect(r.isEstimated).toBe(false);
  });

  it("<unknown> は $0 で isEstimated=false", () => {
    const r = calculateCost(MILLION, "<unknown>");
    expect(r.costUSD).toBe(0);
    expect(r.isEstimated).toBe(false);
  });

  it("usage 全ゼロは既知モデルでも $0", () => {
    const r = calculateCost(emptyUsage(), "claude-opus-4-8");
    expect(r.costUSD).toBe(0);
    expect(r.isEstimated).toBe(false);
  });
});

describe("resolvePricing", () => {
  it("既知プレフィックスは isEstimated=false で単価を返す", () => {
    const r = resolvePricing("claude-fable-5-20260101");
    expect(r.isEstimated).toBe(false);
    expect(r.pricing.input).toBe(10);
    expect(r.pricing.cacheRead).toBe(1);
  });

  it("フォールバックは isEstimated=true", () => {
    const r = resolvePricing("totally-unknown-model");
    expect(r.isEstimated).toBe(true);
    expect(r.pricing.input).toBe(5); // Opus現行
  });
});

describe("calculateCost: OpenAI（Codex）モデル", () => {
  // cacheWrite は OpenAI に存在しないため 0（= 行合計は input+output+cacheRead）
  const cases: Array<[model: string, expected: number]> = [
    ["gpt-5-codex", 1.25 + 10 + 0.125], // 11.375
    ["gpt-5.1", 11.375],
    ["gpt-5-pro", 15 + 120 + 0], // 135
    ["gpt-5-mini", 0.25 + 2 + 0.025], // 2.275
    ["gpt-5-nano", 0.05 + 0.4 + 0.005], // 0.455
  ];

  it.each(cases)("%s: 既知単価（isEstimated=false）", (model, expected) => {
    const r = calculateCost(MILLION, model);
    expect(r.costUSD).toBeCloseTo(expected, 6);
    expect(r.isEstimated).toBe(false);
  });

  it("未知の gpt 系（gpt-5.6-terra 等）は GPT-5 単価で推定扱い", () => {
    const r = calculateCost(MILLION, "gpt-5.6-terra");
    expect(r.costUSD).toBeCloseTo(11.375, 6);
    expect(r.isEstimated).toBe(true);
  });
});

describe("calculateCost: Gemini モデル", () => {
  const cases: Array<[model: string, expected: number]> = [
    ["gemini-3-pro", 2 + 12 + 0.2], // 14.2
    ["gemini-2.5-pro", 1.25 + 10 + 0.31], // 11.56
    ["gemini-2.5-flash", 0.3 + 2.5 + 0.075], // 2.875
    ["gemini-2.5-flash-lite", 0.1 + 0.4 + 0.025], // 0.525
  ];

  it.each(cases)("%s: 既知単価（isEstimated=false）", (model, expected) => {
    const r = calculateCost(MILLION, model);
    expect(r.costUSD).toBeCloseTo(expected, 6);
    expect(r.isEstimated).toBe(false);
  });

  it("未知の gemini 系は Gemini Pro 単価で推定扱い", () => {
    const r = calculateCost(MILLION, "gemini-9-ultra");
    expect(r.costUSD).toBeCloseTo(11.56, 6);
    expect(r.isEstimated).toBe(true);
  });
});

describe("resolvePricing: ソース別デフォルトフォールバック", () => {
  it("どの規則にも合致しないモデルは source のフラッグシップ単価（推定扱い）", () => {
    const codex = resolvePricing("mystery-model", "codex");
    expect(codex.isEstimated).toBe(true);
    expect(codex.pricing.input).toBe(1.25); // GPT-5

    const gemini = resolvePricing("mystery-model", "gemini");
    expect(gemini.isEstimated).toBe(true);
    expect(gemini.pricing.input).toBe(1.25); // Gemini 2.5 Pro
    expect(gemini.pricing.cacheRead).toBe(0.31);

    const claude = resolvePricing("mystery-model", "claude");
    expect(claude.isEstimated).toBe(true);
    expect(claude.pricing.input).toBe(5); // Opus 現行（既存挙動）
  });

  it("source 省略時は claude と同じ既存挙動", () => {
    expect(resolvePricing("mystery-model").pricing.input).toBe(5);
  });
});
