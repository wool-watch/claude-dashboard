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

/** セッション振り返り分析のシステムプロンプト（プロバイダ共通） */
export const SESSION_ANALYSIS_SYSTEM_PROMPT =
  "あなたはAIコーディングエージェントの運用（ハーネス設計・使い方）を改善するコーチです。" +
  "渡されたセッション記録と定量メトリクスを分析し、ユーザーが次のセッションで品質・作業時間・コストを改善するための振り返りを行います。" +
  "アシスタント側の応答品質の評価ではなく、ユーザーの指示の出し方・進め方・検証のさせ方の改善に集中してください。" +
  "評価は必ず記録中の発言とメトリクスの数値を根拠にし、一般論を避けてください。" +
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
      systemPrompt: SESSION_ANALYSIS_SYSTEM_PROMPT,
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
