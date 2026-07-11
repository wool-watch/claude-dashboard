import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AnalysisError,
  parseCliEnvelope,
  runClaudeAnalysis,
  runClaudeJson,
} from "@/lib/analysis/runner";
import { getConfig } from "@/lib/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-runner-"));
});

afterEach(() => {
  delete process.env.CLAUDE_CLI_PATH;
  delete process.env.ANALYSIS_TIMEOUT_MS;
  rmSync(tmpDir, { recursive: true, force: true });
});

const validResult = {
  summary: "テストセッションの要約。",
  goodPoints: ["良い点1"],
  improvements: [{ action: "改善アクション1", category: "その他" }],
  scores: {
    planning: 4,
    contextProvision: 3,
    verification: 5,
    trajectoryStability: 4,
    scopeDiscipline: 3,
  },
};

/** argv と stdin をダンプしてから指定の stdout を返すフェイク claude CLI を作る */
const makeFakeCli = (body: string) => {
  const cliPath = path.join(tmpDir, "fake-claude.sh");
  writeFileSync(
    cliPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${tmpDir}/argv.txt"\ncat > "${tmpDir}/stdin.txt"\n${body}\n`,
  );
  chmodSync(cliPath, 0o755);
  process.env.CLAUDE_CLI_PATH = cliPath;
  return cliPath;
};

const echoEnvelope = (envelope: unknown) =>
  makeFakeCli(`cat <<'ENVELOPE'\n${JSON.stringify(envelope)}\nENVELOPE`);

describe("runClaudeAnalysis: 正常系", () => {
  it("必須引数を渡し stdin にプロンプト全文を書き、結果を返す", async () => {
    echoEnvelope({
      type: "result",
      result: validResult,
      is_error: false,
      total_cost_usd: 0.0123,
    });

    const outcome = await runClaudeAnalysis(
      "分析プロンプト本文\n複数行",
      "sonnet",
      getConfig(),
    );

    expect(outcome.result.summary).toBe("テストセッションの要約。");
    expect(outcome.costUSD).toBe(0.0123);

    const argv = readFileSync(path.join(tmpDir, "argv.txt"), "utf8");
    expect(argv).toContain("--no-session-persistence");
    expect(argv).toContain("sonnet");
    expect(argv).toContain("--json-schema");
    expect(argv).toContain("--output-format");
    const stdin = readFileSync(path.join(tmpDir, "stdin.txt"), "utf8");
    expect(stdin).toBe("分析プロンプト本文\n複数行");
  });

  it("result がJSON文字列のエンベロープも解析できる", async () => {
    echoEnvelope({
      type: "result",
      result: JSON.stringify(validResult),
      is_error: false,
      total_cost_usd: 0.01,
    });
    const outcome = await runClaudeAnalysis("p", "haiku", getConfig());
    expect(outcome.result.goodPoints).toEqual(["良い点1"]);
  });
});

describe("runClaudeAnalysis: 異常系", () => {
  const expectKind = async (promise: Promise<unknown>, kind: string) => {
    try {
      await promise;
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe(kind);
    }
  };

  it("is_error: true は cli-failed", async () => {
    echoEnvelope({
      type: "result",
      result: "budget exceeded",
      is_error: true,
      total_cost_usd: 0,
    });
    await expectKind(runClaudeAnalysis("p", "haiku", getConfig()), "cli-failed");
  });

  it("exit code 非0 は cli-failed", async () => {
    makeFakeCli(`echo "boom" >&2\nexit 1`);
    await expectKind(runClaudeAnalysis("p", "haiku", getConfig()), "cli-failed");
  });

  it("stdout が非JSON は invalid-output", async () => {
    makeFakeCli(`echo "not json"`);
    await expectKind(
      runClaudeAnalysis("p", "haiku", getConfig()),
      "invalid-output",
    );
  });

  it("スキーマ不適合の result は invalid-output", async () => {
    echoEnvelope({
      type: "result",
      result: { ...validResult, scores: { ...validResult.scores, verification: 6 } },
      is_error: false,
      total_cost_usd: 0,
    });
    await expectKind(
      runClaudeAnalysis("p", "haiku", getConfig()),
      "invalid-output",
    );
  });

  it("タイムアウトで timeout", async () => {
    makeFakeCli(`sleep 5`);
    process.env.ANALYSIS_TIMEOUT_MS = "200";
    await expectKind(runClaudeAnalysis("p", "haiku", getConfig()), "timeout");
  }, 10_000);

  it("CLI が存在しなければ cli-not-found", async () => {
    process.env.CLAUDE_CLI_PATH = path.join(tmpDir, "no-such-claude");
    await expectKind(
      runClaudeAnalysis("p", "haiku", getConfig()),
      "cli-not-found",
    );
  });
});

describe("runClaudeJson", () => {
  it("カスタムのモデル・スキーマ・システムプロンプトを渡し、result を未検証のまま返す", async () => {
    echoEnvelope({
      type: "result",
      result: { a: 1 },
      is_error: false,
      total_cost_usd: 0.5,
    });

    const outcome = await runClaudeJson(
      "カスタムプロンプト",
      {
        model: "opus",
        jsonSchema: { type: "object", title: "custom-schema-marker" },
        systemPrompt: "カスタムシステムプロンプト",
      },
      getConfig(),
    );

    expect(outcome.result).toEqual({ a: 1 });
    expect(outcome.costUSD).toBe(0.5);

    const argv = readFileSync(path.join(tmpDir, "argv.txt"), "utf8");
    expect(argv).toContain("opus");
    expect(argv).toContain("custom-schema-marker");
    expect(argv).toContain("カスタムシステムプロンプト");
    expect(argv).toContain("--no-session-persistence");
    const stdin = readFileSync(path.join(tmpDir, "stdin.txt"), "utf8");
    expect(stdin).toBe("カスタムプロンプト");
  });

  it("is_error: true は cli-failed", async () => {
    echoEnvelope({
      type: "result",
      result: "budget exceeded",
      is_error: true,
      total_cost_usd: 0,
    });
    try {
      await runClaudeJson(
        "p",
        { model: "haiku", jsonSchema: {}, systemPrompt: "s" },
        getConfig(),
      );
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("cli-failed");
    }
  });
});

describe("parseCliEnvelope", () => {
  it("total_cost_usd 欠損は null", () => {
    const env = parseCliEnvelope(
      JSON.stringify({ type: "result", result: {}, is_error: false }),
    );
    expect(env.totalCostUsd).toBeNull();
    expect(env.isError).toBe(false);
  });

  it("コードフェンス付きの result 文字列も剥がして解析する", () => {
    const env = parseCliEnvelope(
      JSON.stringify({
        type: "result",
        result: "```json\n{\"a\":1}\n```",
        is_error: false,
      }),
    );
    expect(env.result).toEqual({ a: 1 });
  });

  it("非JSONの stdout は invalid-output を投げる", () => {
    expect(() => parseCliEnvelope("garbage")).toThrow(AnalysisError);
  });
});

describe("中止（AbortSignal）", () => {
  const expectAborted = async (promise: Promise<unknown>) => {
    try {
      await promise;
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("aborted");
    }
  };

  it("runClaudeJson: abort で子プロセスを止め aborted を投げる", async () => {
    makeFakeCli(`sleep 5`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const startedAt = Date.now();
    await expectAborted(
      runClaudeJson(
        "p",
        {
          model: "haiku",
          jsonSchema: {},
          systemPrompt: "s",
          signal: controller.signal,
        },
        getConfig(),
      ),
    );
    // sleep 5 の完了を待たず SIGKILL で即座に終わる
    expect(Date.now() - startedAt).toBeLessThan(3000);
  }, 10_000);

  it("runClaudeAnalysis も signal を透過する", async () => {
    makeFakeCli(`sleep 5`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expectAborted(
      runClaudeAnalysis("p", "haiku", getConfig(), controller.signal),
    );
  }, 10_000);

  it("完了後の abort は無視される", async () => {
    echoEnvelope({
      type: "result",
      result: validResult,
      is_error: false,
      total_cost_usd: 0.01,
    });
    const controller = new AbortController();
    const outcome = await runClaudeAnalysis(
      "p",
      "haiku",
      getConfig(),
      controller.signal,
    );
    controller.abort();
    expect(outcome.result.summary).toBe("テストセッションの要約。");
  });
});
