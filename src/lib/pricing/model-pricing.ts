/** 単価はすべて USD / 1M tokens（2026年時点）。価格改定はこのファイルの編集で完結する */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const FABLE_5: ModelPricing = {
  input: 10,
  output: 50,
  cacheWrite5m: 12.5,
  cacheWrite1h: 20,
  cacheRead: 1,
};

/** Opus 現行世代（4-5〜4-8系） */
const OPUS_CURRENT: ModelPricing = {
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
};

const OPUS_LEGACY: ModelPricing = {
  input: 15,
  output: 75,
  cacheWrite5m: 18.75,
  cacheWrite1h: 30,
  cacheRead: 1.5,
};

const SONNET: ModelPricing = {
  input: 3,
  output: 15,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6,
  cacheRead: 0.3,
};

const HAIKU_45: ModelPricing = {
  input: 1,
  output: 5,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  cacheRead: 0.1,
};

const HAIKU_35: ModelPricing = {
  input: 0.8,
  output: 4,
  cacheWrite5m: 1,
  cacheWrite1h: 1.6,
  cacheRead: 0.08,
};

const ZERO: ModelPricing = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
};

/** 前方一致。上から順に評価するため、具体的な世代プレフィックスをすべて列挙する */
export const PRICING_TABLE: ReadonlyArray<
  readonly [prefix: string, pricing: ModelPricing]
> = [
  ["claude-fable-5", FABLE_5],
  ["claude-opus-4-8", OPUS_CURRENT],
  ["claude-opus-4-7", OPUS_CURRENT],
  ["claude-opus-4-6", OPUS_CURRENT],
  ["claude-opus-4-5", OPUS_CURRENT],
  ["claude-opus-4-1", OPUS_LEGACY],
  ["claude-opus-4-0", OPUS_LEGACY],
  ["claude-sonnet-4-6", SONNET],
  ["claude-sonnet-4-5", SONNET],
  ["claude-sonnet-4-0", SONNET],
  ["claude-haiku-4-5", HAIKU_45],
  ["claude-3-5-haiku", HAIKU_35],
];

/** 部分一致フォールバック（小文字化して比較）。上から順に評価 */
export const FALLBACK_RULES: ReadonlyArray<
  readonly [substring: string, pricing: ModelPricing]
> = [
  ["fable", FABLE_5],
  ["opus", OPUS_CURRENT],
  ["sonnet", SONNET],
  ["haiku", HAIKU_45],
];

export const DEFAULT_FALLBACK: ModelPricing = OPUS_CURRENT;

/** システム生成メッセージ等、課金対象外のモデルID */
const ZERO_COST_MODELS = new Set(["<synthetic>", "<unknown>"]);

export function resolvePricing(model: string): {
  pricing: ModelPricing;
  isEstimated: boolean;
} {
  if (ZERO_COST_MODELS.has(model)) {
    return { pricing: ZERO, isEstimated: false };
  }
  for (const [prefix, pricing] of PRICING_TABLE) {
    if (model.startsWith(prefix)) return { pricing, isEstimated: false };
  }
  const lower = model.toLowerCase();
  for (const [substring, pricing] of FALLBACK_RULES) {
    if (lower.includes(substring)) return { pricing, isEstimated: true };
  }
  return { pricing: DEFAULT_FALLBACK, isEstimated: true };
}
