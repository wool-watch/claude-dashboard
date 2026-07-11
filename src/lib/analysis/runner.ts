import type { AnalysisResult } from "@/lib/analysis/types";
import { ANALYSIS_JSON_SCHEMA, isAnalysisResult } from "@/lib/analysis/types";
import { AnalysisError } from "@/lib/analysis/errors";
import { runClaudeJson } from "@/lib/analysis/providers/claude";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";
import type { AnalysisModel } from "@/lib/settings/settings";

// 互換レイヤー: 既存の import 先を維持する（実体は errors.ts / providers/ へ移設済み）
export { AnalysisError } from "@/lib/analysis/errors";
export type { AnalysisErrorKind } from "@/lib/analysis/errors";
export { parseCliEnvelope, runClaudeJson } from "@/lib/analysis/providers/claude";
export type { CliEnvelope } from "@/lib/analysis/providers/claude";

/** @deprecated ProviderRunOptions（providers/types.ts）へ移行 */
export type RunJsonOptions = ProviderRunOptions;
/** @deprecated ProviderRunOutcome（providers/types.ts）へ移行 */
export type RunJsonOutcome = ProviderRunOutcome;

export interface RunOutcome {
  result: AnalysisResult;
  costUSD: number | null;
}

const SYSTEM_PROMPT =
  "あなたはAIコーディングアシスタント「Claude Code」の利用方法を改善するコーチです。" +
  "渡されたセッションのやり取りを分析し、ユーザー側の指示の出し方・作業の進め方について振り返りを行います。" +
  "アシスタント側の応答品質の評価ではなく、ユーザーが次のセッションでより良い結果を得るための観点に集中してください。" +
  "ツールは一切使用せず、指定されたJSONスキーマに従って日本語で出力してください。";

/** セッション振り返り分析（固定スキーマ・固定システムプロンプト） */
export async function runClaudeAnalysis(
  prompt: string,
  model: AnalysisModel,
  config: DashboardConfig,
  signal?: AbortSignal,
): Promise<RunOutcome> {
  const outcome = await runClaudeJson(
    prompt,
    {
      model,
      jsonSchema: ANALYSIS_JSON_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      signal,
    },
    config,
  );
  if (!isAnalysisResult(outcome.result)) {
    throw new AnalysisError(
      "分析結果が期待する形式ではありません",
      "invalid-output",
    );
  }
  return { result: outcome.result, costUSD: outcome.costUSD };
}
