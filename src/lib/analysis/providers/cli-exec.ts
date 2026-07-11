import { spawn } from "node:child_process";
import os from "node:os";
import { AnalysisError } from "@/lib/analysis/errors";

export interface CliExecOptions {
  timeoutMs: number;
  /** abort で子プロセスを SIGKILL する */
  signal?: AbortSignal;
  /** 省略時は os.tmpdir()（プロジェクトの CLAUDE.md 等を読み込ませない） */
  cwd?: string;
}

export interface CliExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

/**
 * CLI をヘッドレスで起動し stdin にプロンプトを流し込む汎用実行器。
 * タイムアウト・abort・spawn 失敗はフラグで返す（例外にしない）。
 * エラーへの変換は ensureCliSuccess で行う。
 */
export function execCli(
  binPath: string,
  args: string[],
  stdin: string,
  options: CliExecOptions,
): Promise<CliExecResult> {
  return new Promise<CliExecResult>((resolve) => {
    const child = spawn(binPath, args, {
      cwd: options.cwd ?? os.tmpdir(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOutFlag = false;
    let abortedFlag = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOutFlag = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    timer.unref();

    const onAbort = () => {
      abortedFlag = true;
      child.kill("SIGKILL");
    };
    if (options.signal?.aborted === true) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort);
    }

    const settle = (
      code: number | null,
      spawnError: NodeJS.ErrnoException | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        stdout: stdoutBuf,
        stderr: stderrBuf,
        code,
        timedOut: timedOutFlag,
        aborted: abortedFlag,
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
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export interface CliErrorContext {
  /** エラーメッセージに使う表示名（例: "Claude Code CLI"） */
  displayName: string;
  /** 実行しようとしたコマンドのパス */
  binPath: string;
  /** cli-not-found 時の対処ヒント（例: "設定画面でパスを指定してください"） */
  notFoundHint: string;
  timeoutMs: number;
}

/** execCli の結果をプロバイダ共通の AnalysisError へ変換する（正常終了なら何もしない） */
export function ensureCliSuccess(
  result: CliExecResult,
  context: CliErrorContext,
): void {
  if (result.spawnError !== null) {
    if (result.spawnError.code === "ENOENT") {
      throw new AnalysisError(
        `${context.displayName} が見つかりません（${context.binPath}）。${context.notFoundHint}`,
        "cli-not-found",
      );
    }
    throw new AnalysisError(
      `${context.displayName} の起動に失敗しました: ${result.spawnError.message}`,
      "cli-failed",
    );
  }
  if (result.aborted) {
    // timeout と同時発火した場合も中止を優先する
    throw new AnalysisError("分析を中止しました", "aborted");
  }
  if (result.timedOut) {
    throw new AnalysisError(
      `分析がタイムアウトしました（${Math.round(context.timeoutMs / 1000)}秒）`,
      "timeout",
    );
  }
  if (result.code !== 0) {
    throw new AnalysisError(
      `${context.displayName} がエラー終了しました（exit ${result.code}）: ${result.stderr.slice(0, 200)}`,
      "cli-failed",
    );
  }
}
