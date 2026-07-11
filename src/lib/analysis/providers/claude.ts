import { AnalysisError } from "@/lib/analysis/errors";
import { ensureCliSuccess, execCli } from "@/lib/analysis/providers/cli-exec";
import { stripCodeFence } from "@/lib/analysis/providers/json-extract";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";

export interface CliEnvelope {
  result: unknown;
  isError: boolean;
  totalCostUsd: number | null;
}

/** claude -p --output-format json の stdout を防御的に解析する */
export function parseCliEnvelope(stdout: string): CliEnvelope {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new AnalysisError(
      `CLI出力がJSONではありません: ${stdout.slice(0, 200)}`,
      "invalid-output",
    );
  }
  if (typeof envelope !== "object" || envelope === null) {
    throw new AnalysisError("CLI出力の形式が不正です", "invalid-output");
  }
  const env = envelope as Record<string, unknown>;
  let result: unknown = env.result;
  if (typeof result === "string") {
    // --json-schema 使用時も result が JSON 文字列で返ることがある
    try {
      result = JSON.parse(stripCodeFence(result));
    } catch {
      // 文字列のまま（エラーメッセージ等）
    }
  }
  return {
    result,
    isError: env.is_error === true,
    totalCostUsd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
  };
}

/**
 * Claude Code CLI をヘッドレスで起動し、指定スキーマのJSONを受け取る汎用ランナー。
 * --no-session-persistence: 分析実行が ~/.claude/projects に新セッションを生む
 * 再帰汚染を防ぐ（本ダッシュボード自身がそこを読むため必須）。
 * result のスキーマ検証は行わない（呼出側の責務）。
 * @param cliPath 省略時は config.claudeCliPath（CLAUDE_CLI_PATH / "claude"）
 */
export async function runClaudeJson(
  prompt: string,
  options: ProviderRunOptions,
  config: DashboardConfig,
  cliPath?: string,
): Promise<ProviderRunOutcome> {
  const bin = cliPath !== undefined && cliPath !== "" ? cliPath : config.claudeCliPath;
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(options.jsonSchema),
    "--model",
    options.model,
    "--max-budget-usd",
    String(config.analysisMaxBudgetUsd),
    "--no-session-persistence",
    "--setting-sources",
    "user",
    "--system-prompt",
    options.systemPrompt,
    "--disallowedTools",
    "Bash,Edit,Write,NotebookEdit,WebSearch,WebFetch,Task",
  ];

  const execResult = await execCli(bin, args, prompt, {
    timeoutMs: config.analysisTimeoutMs,
    signal: options.signal,
  });
  ensureCliSuccess(execResult, {
    displayName: "Claude Code CLI",
    binPath: bin,
    notFoundHint: "CLAUDE_CLI_PATH で場所を指定できます",
    timeoutMs: config.analysisTimeoutMs,
  });

  const envelope = parseCliEnvelope(execResult.stdout);
  if (envelope.isError) {
    const detail =
      typeof envelope.result === "string" ? envelope.result.slice(0, 200) : "";
    throw new AnalysisError(`分析の実行に失敗しました: ${detail}`, "cli-failed");
  }
  return { result: envelope.result, costUSD: envelope.totalCostUsd };
}
