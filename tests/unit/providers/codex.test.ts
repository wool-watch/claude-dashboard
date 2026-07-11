import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalysisError } from "@/lib/analysis/errors";
import { runCodexJson } from "@/lib/analysis/providers/codex";
import type { ProviderRunOptions } from "@/lib/analysis/providers/types";
import { getConfig } from "@/lib/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-codex-"));
});

afterEach(() => {
  delete process.env.ANALYSIS_TIMEOUT_MS;
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
  model: "gpt-5-codex",
  jsonSchema: SCHEMA,
  systemPrompt: "システムプロンプト",
  ...overrides,
});

/**
 * argv / stdin / --output-schema の中身をダンプし、
 * --output-last-message で渡されたファイルへ lastMessage を書くフェイク codex CLI
 */
const makeFakeCodex = (lastMessage: string, exitCode = 0) => {
  const cliPath = path.join(tmpDir, "fake-codex.sh");
  writeFileSync(
    cliPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > "${tmpDir}/argv.txt"`,
      `cat > "${tmpDir}/stdin.txt"`,
      'out=""; schema=""; prev=""',
      'for a in "$@"; do',
      '  [ "$prev" = "--output-last-message" ] && out="$a"',
      '  [ "$prev" = "--output-schema" ] && schema="$a"',
      '  prev="$a"',
      "done",
      `[ -n "$schema" ] && cp "$schema" "${tmpDir}/schema-copy.json"`,
      `[ -n "$out" ] && cat <<'LAST_MESSAGE' > "$out"`,
      lastMessage,
      "LAST_MESSAGE",
      exitCode === 0 ? "exit 0" : `echo "codex error" >&2; exit ${exitCode}`,
    ].join("\n"),
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
};

const argvLines = () =>
  readFileSync(path.join(tmpDir, "argv.txt"), "utf8").trim().split("\n");

/** argv から指定フラグの次の値を取り出す */
const argAfter = (flag: string) => {
  const argv = argvLines();
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

describe("runCodexJson: 正常系", () => {
  it("codex exec 相当の引数で起動し、last-message から結果を得る", async () => {
    const cliPath = makeFakeCodex('{"summary":"codexの要約"}');

    const outcome = await runCodexJson(
      "プロンプト本文",
      runOptions(),
      getConfig(),
      cliPath,
    );

    expect(outcome.result).toEqual({ summary: "codexの要約" });
    expect(outcome.costUSD).toBeNull();

    const argv = argvLines();
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--skip-git-repo-check");
    expect(argv).toContain("--sandbox");
    expect(argv).toContain("read-only");
    expect(argv).toContain("--ephemeral");
    expect(argAfter("--model")).toBe("gpt-5-codex");
    expect(argv).toContain("-"); // プロンプトは stdin

    // system prompt はプロンプト先頭に結合される
    const stdin = readFileSync(path.join(tmpDir, "stdin.txt"), "utf8");
    expect(stdin).toContain("システムプロンプト");
    expect(stdin).toContain("プロンプト本文");
    expect(stdin.indexOf("システムプロンプト")).toBeLessThan(
      stdin.indexOf("プロンプト本文"),
    );

    // スキーマは一時ファイル経由で渡される
    const schemaCopy = JSON.parse(
      readFileSync(path.join(tmpDir, "schema-copy.json"), "utf8"),
    );
    expect(schemaCopy).toEqual(SCHEMA);
  });

  it("一時ファイル（スキーマ・last-message）を実行後に削除する", async () => {
    const cliPath = makeFakeCodex('{"summary":"x"}');
    await runCodexJson("p", runOptions(), getConfig(), cliPath);

    const schemaPath = argAfter("--output-schema");
    const outPath = argAfter("--output-last-message");
    expect(schemaPath).toBeDefined();
    expect(outPath).toBeDefined();
    expect(existsSync(String(schemaPath))).toBe(false);
    expect(existsSync(String(outPath))).toBe(false);
  });

  it("前置きテキスト付きの last-message からも JSON を抽出する", async () => {
    const cliPath = makeFakeCodex('結果は以下です:\n{"summary":"抽出成功"}');
    const outcome = await runCodexJson("p", runOptions(), getConfig(), cliPath);
    expect(outcome.result).toEqual({ summary: "抽出成功" });
  });
});

describe("runCodexJson: エラー", () => {
  it("CLI が見つからなければ cli-not-found（設定画面のヒント付き）", async () => {
    try {
      await runCodexJson(
        "p",
        runOptions(),
        getConfig(),
        path.join(tmpDir, "no-such-codex"),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("cli-not-found");
      expect((e as AnalysisError).message).toContain("Codex CLI");
      expect((e as AnalysisError).message).toContain("設定画面");
    }
  });

  it("非0終了は cli-failed（stderr を含む）", async () => {
    const cliPath = makeFakeCodex("", 1);
    try {
      await runCodexJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("cli-failed");
      expect((e as AnalysisError).message).toContain("codex error");
    }
  });

  it("last-message が JSON を含まなければ invalid-output", async () => {
    const cliPath = makeFakeCodex("すみません、できません");
    try {
      await runCodexJson("p", runOptions(), getConfig(), cliPath);
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });

  it("エラー時も一時ファイルを残さない", async () => {
    const cliPath = makeFakeCodex("", 1);
    await runCodexJson("p", runOptions(), getConfig(), cliPath).catch(() => {});
    const schemaPath = argAfter("--output-schema");
    expect(existsSync(String(schemaPath))).toBe(false);
  });
});
