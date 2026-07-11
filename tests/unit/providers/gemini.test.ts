import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalysisError } from "@/lib/analysis/errors";
import { runGeminiJson } from "@/lib/analysis/providers/gemini";
import type { ProviderRunOptions } from "@/lib/analysis/providers/types";
import { getConfig } from "@/lib/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-gemini-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
} as const;

const runOptions = (
  overrides?: Partial<ProviderRunOptions>,
): ProviderRunOptions => ({
  model: "gemini-2.5-flash",
  jsonSchema: SCHEMA,
  systemPrompt: "システムプロンプト",
  ...overrides,
});

/** argv / stdin をダンプし、-o json のエンベロープを stdout に返すフェイク gemini CLI */
const makeFakeGemini = (stdout: string, exitCode = 0) => {
  const cliPath = path.join(tmpDir, "fake-gemini.sh");
  writeFileSync(
    cliPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > "${tmpDir}/argv.txt"`,
      `cat > "${tmpDir}/stdin.txt"`,
      "cat <<'STDOUT_BODY'",
      stdout,
      "STDOUT_BODY",
      exitCode === 0 ? "exit 0" : `echo "gemini error" >&2; exit ${exitCode}`,
    ].join("\n"),
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
};

const envelope = (response: string) => JSON.stringify({ response, stats: {} });

const argvText = () => readFileSync(path.join(tmpDir, "argv.txt"), "utf8");
const stdinText = () => readFileSync(path.join(tmpDir, "stdin.txt"), "utf8");

describe("runGeminiJson: 正常系", () => {
  it("ヘッドレス引数で起動し、エンベロープの response から JSON を得る", async () => {
    const cliPath = makeFakeGemini(envelope('{"summary":"geminiの要約"}'));

    const outcome = await runGeminiJson(
      "プロンプト本文",
      runOptions(),
      getConfig(),
      cliPath,
    );

    expect(outcome.result).toEqual({ summary: "geminiの要約" });
    expect(outcome.costUSD).toBeNull();

    const argv = argvText();
    expect(argv).toContain("--output-format");
    expect(argv).toContain("json");
    expect(argv).toContain("--model");
    expect(argv).toContain("gemini-2.5-flash");
    expect(argv).toContain("--approval-mode");
    expect(argv).toContain("plan");
    expect(argv).not.toContain("--yolo");

    // system prompt とスキーマはプロンプトへ埋め込む（構造化出力フラグが無いため）
    const stdin = stdinText();
    expect(stdin).toContain("システムプロンプト");
    expect(stdin).toContain('"summary"'); // スキーマ埋め込み
    expect(stdin).toContain("プロンプト本文");
  });

  it("response 内のコードフェンス・前置きテキストから JSON を抽出する", async () => {
    const cliPath = makeFakeGemini(
      envelope('結果です:\n```json\n{"summary":"抽出成功"}\n```'),
    );
    const outcome = await runGeminiJson("p", runOptions(), getConfig(), cliPath);
    expect(outcome.result).toEqual({ summary: "抽出成功" });
  });
});

describe("runGeminiJson: エラー", () => {
  it("CLI が見つからなければ cli-not-found（設定画面のヒント付き）", async () => {
    try {
      await runGeminiJson(
        "p",
        runOptions(),
        getConfig(),
        path.join(tmpDir, "no-such-gemini"),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("cli-not-found");
      expect((e as AnalysisError).message).toContain("Gemini CLI");
      expect((e as AnalysisError).message).toContain("設定画面");
    }
  });

  it("非0終了は cli-failed（stderr を含む）", async () => {
    const cliPath = makeFakeGemini("", 1);
    try {
      await runGeminiJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("cli-failed");
      expect((e as AnalysisError).message).toContain("gemini error");
    }
  });

  it("stdout が JSON エンベロープでなければ invalid-output", async () => {
    const cliPath = makeFakeGemini("plain text output");
    try {
      await runGeminiJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });

  it("response フィールドが無ければ invalid-output", async () => {
    const cliPath = makeFakeGemini(JSON.stringify({ stats: {} }));
    try {
      await runGeminiJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });

  it("response が JSON を含まなければ invalid-output", async () => {
    const cliPath = makeFakeGemini(envelope("すみません、できません"));
    try {
      await runGeminiJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });
});
