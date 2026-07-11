import { AnalysisError } from "@/lib/analysis/errors";
import { ensureCliSuccess, execCli } from "@/lib/analysis/providers/cli-exec";
import { extractJson } from "@/lib/analysis/providers/json-extract";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";

/**
 * Gemini CLI をヘッドレス（-p / --output-format json）で起動して JSON を生成する。
 * - 構造化出力フラグが無いため、スキーマは stdin のプロンプトへ埋め込み、
 *   応答（エンベロープの response 文字列）から extractJson で取り出す
 * - --approval-mode plan: 読み取り専用モードでツール実行を封じる
 * - コストは取得できないため costUSD は常に null
 */
export async function runGeminiJson(
  prompt: string,
  options: ProviderRunOptions,
  config: DashboardConfig,
  cliPath: string,
): Promise<ProviderRunOutcome> {
  const bin = cliPath !== "" ? cliPath : "gemini";
  const args = [
    "--output-format",
    "json",
    "--model",
    options.model,
    "--approval-mode",
    "plan",
    // stdin の入力に -p の指示が後置される（Gemini CLI の仕様）
    "-p",
    "上記の指示に従い、JSONオブジェクトのみを出力してください",
  ];
  const stdin = [
    options.systemPrompt,
    "出力は次のJSON Schemaに厳密に従うJSONオブジェクトのみとし、" +
      `他のテキストを含めないでください:\n${JSON.stringify(options.jsonSchema)}`,
    prompt,
  ].join("\n\n");

  const execResult = await execCli(bin, args, stdin, {
    timeoutMs: config.analysisTimeoutMs,
    signal: options.signal,
  });
  ensureCliSuccess(execResult, {
    displayName: "Gemini CLI",
    binPath: bin,
    notFoundHint: "設定画面でパスを指定してください",
    timeoutMs: config.analysisTimeoutMs,
  });

  let envelope: unknown;
  try {
    envelope = JSON.parse(execResult.stdout.trim());
  } catch {
    throw new AnalysisError(
      `Gemini CLI の出力がJSONではありません: ${execResult.stdout.slice(0, 200)}`,
      "invalid-output",
    );
  }
  const response =
    typeof envelope === "object" && envelope !== null
      ? (envelope as { response?: unknown }).response
      : undefined;
  if (typeof response !== "string") {
    throw new AnalysisError(
      "Gemini CLI の出力に response がありません",
      "invalid-output",
    );
  }
  return { result: extractJson(response), costUSD: null };
}
