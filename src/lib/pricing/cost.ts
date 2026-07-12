import type { SessionSourceId } from "@/lib/sources/types";
import type { UsageTotals } from "@/lib/types";
import { resolvePricing } from "./model-pricing";

/** 丸めは表示側（components/format.ts）の責務なのでここでは行わない */
export function calculateCost(
  usage: UsageTotals,
  model: string,
  source: SessionSourceId = "claude",
): { costUSD: number; isEstimated: boolean } {
  const { pricing, isEstimated } = resolvePricing(model, source);
  const costUSD =
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheWrite5mTokens * pricing.cacheWrite5m +
      usage.cacheWrite1hTokens * pricing.cacheWrite1h +
      usage.cacheReadTokens * pricing.cacheRead) /
    1_000_000;
  return { costUSD, isEstimated };
}
