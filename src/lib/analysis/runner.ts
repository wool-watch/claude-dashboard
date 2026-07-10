import { spawn } from "node:child_process";
import os from "node:os";
import type { AnalysisResult } from "@/lib/analysis/types";
import { ANALYSIS_JSON_SCHEMA, isAnalysisResult } from "@/lib/analysis/types";
import type { DashboardConfig } from "@/lib/config";
import type { AnalysisModel } from "@/lib/settings/settings";

export type AnalysisErrorKind =
  | "cli-not-found"
  | "cli-failed"
  | "timeout"
  | "invalid-output"
  | "in-flight"
  | "no-conversation"
  | "no-analyses";

export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly kind: AnalysisErrorKind,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}

export interface CliEnvelope {
  result: unknown;
  isError: boolean;
  totalCostUsd: number | null;
}

export interface RunOutcome {
  result: AnalysisResult;
  costUSD: number | null;
}

/** runClaudeJson に渡す実行オプション（スキーマ・プロンプトは呼出側が決める） */
export interface RunJsonOptions {
  model: string;
  jsonSchema: object;
  systemPrompt: string;
}

/** runClaudeJson の結果。result の検証は呼出側の責務 */
export interface RunJsonOutcome {
  result: unknown;
  costUSD: number | null;
}

const SYSTEM_PROMPT =
  "あなたはAIコーディングアシスタント「Claude Code」の利用方法を改善するコーチです。" +
  "渡されたセッションのやり取りを分析し、ユーザー側の指示の出し方・作業の進め方について振り返りを行います。" +
  "アシスタント側の応答品質の評価ではなく、ユーザーが次のセッションでより良い結果を得るための観点に集中してください。" +
  "ツールは一切使用せず、指定されたJSONスキーマに従って日本語で出力してください。";

/** 「```json ... ```」等のコードフェンスを剥がす */
function stripCodeFence(s: string): string {
  const m = /^\s*```[a-z]*\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(s);
  return m !== null ? m[1] : s;
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
 * cwd は os.tmpdir(): プロジェクトの CLAUDE.md 等を読み込ませない。
 * result のスキーマ検証は行わない（呼出側の責務）。
 */
export async function runClaudeJson(
  prompt: string,
  options: RunJsonOptions,
  config: DashboardConfig,
): Promise<RunJsonOutcome> {
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

  const { stdout, stderr, code, timedOut, spawnError } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
    spawnError: NodeJS.ErrnoException | null;
  }>((resolve) => {
    const child = spawn(config.claudeCliPath, args, {
      cwd: os.tmpdir(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOutFlag = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOutFlag = true;
      child.kill("SIGKILL");
    }, config.analysisTimeoutMs);
    timer.unref();

    const settle = (
      code: number | null,
      spawnError: NodeJS.ErrnoException | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdoutBuf,
        stderr: stderrBuf,
        code,
        timedOut: timedOutFlag,
        spawnError,
      });
    };

    child.stdout.on("data", (d: Buffer) => {
      stdoutBuf += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) => settle(null, e));
    child.on("close", (code) => settle(code, null));
    child.stdin.on("error", () => {}); // 早期終了時の EPIPE を無視
    child.stdin.write(prompt);
    child.stdin.end();
  });

  if (spawnError !== null) {
    if (spawnError.code === "ENOENT") {
      throw new AnalysisError(
        `Claude Code CLI が見つかりません（${config.claudeCliPath}）。CLAUDE_CLI_PATH で場所を指定できます`,
        "cli-not-found",
      );
    }
    throw new AnalysisError(
      `Claude Code CLI の起動に失敗しました: ${spawnError.message}`,
      "cli-failed",
    );
  }
  if (timedOut) {
    throw new AnalysisError(
      `分析がタイムアウトしました（${Math.round(config.analysisTimeoutMs / 1000)}秒）`,
      "timeout",
    );
  }
  if (code !== 0) {
    throw new AnalysisError(
      `Claude Code CLI がエラー終了しました（exit ${code}）: ${stderr.slice(0, 200)}`,
      "cli-failed",
    );
  }

  const envelope = parseCliEnvelope(stdout);
  if (envelope.isError) {
    const detail =
      typeof envelope.result === "string" ? envelope.result.slice(0, 200) : "";
    throw new AnalysisError(`分析の実行に失敗しました: ${detail}`, "cli-failed");
  }
  return { result: envelope.result, costUSD: envelope.totalCostUsd };
}

/** セッション振り返り分析（固定スキーマ・固定システムプロンプト） */
export async function runClaudeAnalysis(
  prompt: string,
  model: AnalysisModel,
  config: DashboardConfig,
): Promise<RunOutcome> {
  const outcome = await runClaudeJson(
    prompt,
    {
      model,
      jsonSchema: ANALYSIS_JSON_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
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
