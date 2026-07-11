import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisError } from "@/lib/analysis/errors";
import { runOpenAiCompatJson } from "@/lib/analysis/providers/openai-compat";
import type { ProviderRunOptions } from "@/lib/analysis/providers/types";
import { getConfig } from "@/lib/config";

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
} as const;

const runOptions = (overrides?: Partial<ProviderRunOptions>): ProviderRunOptions => ({
  model: "qwen3-8b",
  jsonSchema: SCHEMA,
  systemPrompt: "システムプロンプト",
  ...overrides,
});

const TARGET = {
  baseUrl: "http://localhost:1234/v1",
  displayName: "LM Studio",
};

/** OpenAI互換 chat.completions の成功レスポンス body */
const completion = (content: string) => ({
  choices: [{ message: { role: "assistant", content } }],
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type FetchCall = { url: string; init: RequestInit };

/** fetch をモックし、呼び出しを記録する */
const stubFetch = (
  impl: (call: FetchCall, callIndex: number) => Promise<Response>,
) => {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return impl(call, calls.length - 1);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
};

const parseBody = (call: FetchCall) =>
  JSON.parse(String(call.init.body)) as Record<string, unknown>;

const expectKind = async (p: Promise<unknown>, kind: string) => {
  try {
    await p;
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(AnalysisError);
    expect((e as AnalysisError).kind).toBe(kind);
    return e as AnalysisError;
  }
};

beforeEach(() => {
  process.env.ANALYSIS_TIMEOUT_MS = "30000";
});

afterEach(() => {
  delete process.env.ANALYSIS_TIMEOUT_MS;
  vi.unstubAllGlobals();
});

describe("runOpenAiCompatJson: 正常系", () => {
  it("chat/completions に json_schema 付きで POST し、応答をパースする", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse(completion('{"summary":"要約です"}')),
    );

    const outcome = await runOpenAiCompatJson(
      "プロンプト本文",
      runOptions(),
      getConfig(),
      TARGET,
    );

    expect(outcome.result).toEqual({ summary: "要約です" });
    expect(outcome.costUSD).toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:1234/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");

    const body = parseBody(calls[0]);
    expect(body.model).toBe("qwen3-8b");
    expect(body.messages).toEqual([
      { role: "system", content: "システムプロンプト" },
      { role: "user", content: "プロンプト本文" },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "analysis", strict: true, schema: SCHEMA },
    });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBeUndefined();
  });

  it("baseUrl 末尾の / を正規化する", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse(completion('{"summary":"x"}')),
    );
    await runOpenAiCompatJson("p", runOptions(), getConfig(), {
      ...TARGET,
      baseUrl: "http://localhost:1234/v1/",
    });
    expect(calls[0].url).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("apiKey があれば Authorization: Bearer を付ける", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse(completion('{"summary":"x"}')),
    );
    await runOpenAiCompatJson("p", runOptions(), getConfig(), {
      ...TARGET,
      apiKey: "sk-test-1",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-1");
  });

  it("コードフェンス付きの content もパースする", async () => {
    stubFetch(async () =>
      jsonResponse(completion('```json\n{"summary":"x"}\n```')),
    );
    const outcome = await runOpenAiCompatJson(
      "p",
      runOptions(),
      getConfig(),
      TARGET,
    );
    expect(outcome.result).toEqual({ summary: "x" });
  });
});

describe("runOpenAiCompatJson: response_format フォールバック", () => {
  it("json_schema 非対応 400 なら json_object + スキーマ埋め込みでリトライする", async () => {
    const { calls } = stubFetch(async (_call, i) =>
      i === 0
        ? jsonResponse(
            { error: { message: "response_format json_schema is not supported" } },
            400,
          )
        : jsonResponse(completion('{"summary":"再試行成功"}')),
    );

    const outcome = await runOpenAiCompatJson(
      "p",
      runOptions(),
      getConfig(),
      TARGET,
    );
    expect(outcome.result).toEqual({ summary: "再試行成功" });

    expect(calls).toHaveLength(2);
    const retryBody = parseBody(calls[1]);
    expect(retryBody.response_format).toEqual({ type: "json_object" });
    const messages = retryBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('"summary"'); // スキーマ埋め込み
  });

  it("json_object も 400 なら response_format 無しで最終リトライする", async () => {
    const { calls } = stubFetch(async (_call, i) =>
      i <= 1
        ? jsonResponse(
            { error: { message: "response_format is not supported" } },
            400,
          )
        : jsonResponse(completion('{"summary":"最終成功"}')),
    );

    const outcome = await runOpenAiCompatJson(
      "p",
      runOptions(),
      getConfig(),
      TARGET,
    );
    expect(outcome.result).toEqual({ summary: "最終成功" });

    expect(calls).toHaveLength(3);
    expect("response_format" in parseBody(calls[2])).toBe(false);
  });

  it("response_format と無関係の 400 はリトライせず cli-failed", async () => {
    const { calls } = stubFetch(async () =>
      jsonResponse({ error: { message: "model not found" } }, 400),
    );
    await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "cli-failed",
    );
    expect(calls).toHaveLength(1);
  });
});

describe("runOpenAiCompatJson: エラー", () => {
  it("接続失敗（fetch 例外）は connection-failed で baseUrl を含む", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const e = await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "connection-failed",
    );
    expect(e.message).toContain("LM Studio");
    expect(e.message).toContain("http://localhost:1234/v1");
  });

  it("401 はキー拒否として cli-failed", async () => {
    stubFetch(async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401),
    );
    const e = await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "cli-failed",
    );
    expect(e.message).toContain("401");
  });

  it("500 は cli-failed", async () => {
    stubFetch(async () => jsonResponse({ error: "boom" }, 500));
    await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "cli-failed",
    );
  });

  it("タイムアウトで timeout", async () => {
    process.env.ANALYSIS_TIMEOUT_MS = "50";
    stubFetch(
      (call) =>
        new Promise((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "timeout",
    );
  });

  it("呼出側 signal の中止で aborted", async () => {
    const controller = new AbortController();
    stubFetch(
      (call) =>
        new Promise((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const p = runOpenAiCompatJson(
      "p",
      runOptions({ signal: controller.signal }),
      getConfig(),
      TARGET,
    );
    setTimeout(() => controller.abort(), 10);
    await expectKind(p, "aborted");
  });

  it("content が JSON でなければ invalid-output", async () => {
    stubFetch(async () => jsonResponse(completion("すみません、できません")));
    await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "invalid-output",
    );
  });

  it("choices が無い応答は invalid-output", async () => {
    stubFetch(async () => jsonResponse({ unexpected: true }));
    await expectKind(
      runOpenAiCompatJson("p", runOptions(), getConfig(), TARGET),
      "invalid-output",
    );
  });
});
