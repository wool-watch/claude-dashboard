import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalysisError } from "@/lib/analysis/errors";
import { ensureCliSuccess, execCli } from "@/lib/analysis/providers/cli-exec";
import { extractJson } from "@/lib/analysis/providers/json-extract";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";

/**
 * Codex CLI（codex exec）で JSON を生成する。
 * - スキーマは --output-schema（ファイルパス渡し）、応答は --output-last-message で受け取る
 * - system prompt 相当のフラグが無いためプロンプト先頭に結合する
 * - --ephemeral: セッションを永続化しない / --sandbox read-only: ツール実行を封じる
 * - コストは取得できないため costUSD は常に null
 */
export async function runCodexJson(
  prompt: string,
  options: ProviderRunOptions,
  config: DashboardConfig,
  cliPath: string,
): Promise<ProviderRunOutcome> {
  const bin = cliPath !== "" ? cliPath : "codex";
  const id = randomUUID();
  const schemaPath = path.join(os.tmpdir(), `codex-schema-${id}.json`);
  const lastMessagePath = path.join(os.tmpdir(), `codex-last-message-${id}.txt`);

  try {
    await fs.writeFile(schemaPath, JSON.stringify(options.jsonSchema), {
      mode: 0o600,
    });

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--model",
      options.model,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      lastMessagePath,
      "-",
    ];
    const stdin = `${options.systemPrompt}\n\n${prompt}`;

    const execResult = await execCli(bin, args, stdin, {
      timeoutMs: config.analysisTimeoutMs,
      signal: options.signal,
    });
    ensureCliSuccess(execResult, {
      displayName: "Codex CLI",
      binPath: bin,
      notFoundHint: "設定画面でパスを指定してください",
      timeoutMs: config.analysisTimeoutMs,
    });

    // 応答は last-message ファイル優先、読めなければ stdout から抽出を試みる
    let lastMessage: string;
    try {
      lastMessage = await fs.readFile(lastMessagePath, "utf8");
    } catch {
      lastMessage = "";
    }
    const text = lastMessage.trim() !== "" ? lastMessage : execResult.stdout;
    if (text.trim() === "") {
      throw new AnalysisError(
        "Codex CLI が応答を返しませんでした",
        "invalid-output",
      );
    }
    return { result: extractJson(text), costUSD: null };
  } finally {
    await fs.rm(schemaPath, { force: true }).catch(() => {});
    await fs.rm(lastMessagePath, { force: true }).catch(() => {});
  }
}
