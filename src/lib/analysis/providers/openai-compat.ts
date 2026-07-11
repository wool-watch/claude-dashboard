import { AnalysisError } from "@/lib/analysis/errors";
import { extractJson } from "@/lib/analysis/providers/json-extract";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";

/** LM Studio と汎用 OpenAI 互換 API の接続先（差は baseUrl デフォルトと apiKey の有無のみ） */
export interface OpenAiCompatTarget {
  baseUrl: string;
  /** 空文字・省略時は Authorization ヘッダを付けない（LM Studio 等のローカルサーバー） */
  apiKey?: string;
  /** エラーメッセージに使う表示名（例: "LM Studio"） */
  displayName: string;
}

/**
 * response_format の対応状況はモデル・サーバーによって異なるため段階的に緩める:
 * json_schema（構造化出力）→ json_object + スキーマ埋め込み → 指定なし + スキーマ埋め込み
 */
const FORMAT_MODES = ["json_schema", "json_object", "none"] as const;
type FormatMode = (typeof FORMAT_MODES)[number];

/** 400 の本文が response_format 非対応を示すか（それ以外の 400 はリトライしない） */
const isFormatRejection = (bodyText: string): boolean =>
  /response_format|json_schema|json_object/i.test(bodyText);

/** choices[0].message.content を防御的に取り出す */
function getMessageContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * OpenAI 互換 API（LM Studio / Ollama / vLLM 等）で JSON を生成する。
 * コストは取得できないため costUSD は常に null。
 * result のスキーマ検証は行わない（呼出側の責務）。
 */
export async function runOpenAiCompatJson(
  prompt: string,
  options: ProviderRunOptions,
  config: DashboardConfig,
  target: OpenAiCompatTarget,
): Promise<ProviderRunOutcome> {
  const baseUrl = target.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (target.apiKey !== undefined && target.apiKey !== "") {
    headers.authorization = `Bearer ${target.apiKey}`;
  }

  // タイムアウトは全リトライ含む合計で config.analysisTimeoutMs
  const timeoutSignal = AbortSignal.timeout(config.analysisTimeoutMs);
  const signal =
    options.signal !== undefined
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;

  const schemaText = JSON.stringify(options.jsonSchema);
  const embeddedSchemaPrompt =
    `${options.systemPrompt}\n\n` +
    "出力は次のJSON Schemaに厳密に従うJSONオブジェクトのみとし、" +
    `他のテキストを含めないでください:\n${schemaText}`;

  for (const mode of FORMAT_MODES) {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: [
        {
          role: "system",
          content: mode === "json_schema" ? options.systemPrompt : embeddedSchemaPrompt,
        },
        { role: "user", content: prompt },
      ],
    };
    if (mode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "analysis", strict: true, schema: options.jsonSchema },
      };
    } else if (mode === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (options.signal?.aborted === true) {
        throw new AnalysisError("分析を中止しました", "aborted");
      }
      if (timeoutSignal.aborted) {
        throw new AnalysisError(
          `分析がタイムアウトしました（${Math.round(config.analysisTimeoutMs / 1000)}秒）`,
          "timeout",
        );
      }
      throw new AnalysisError(
        `${target.displayName} に接続できません（${target.baseUrl}）。サーバーが起動しているか確認してください`,
        "connection-failed",
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new AnalysisError(
        `APIキーが拒否されました（HTTP ${res.status}）`,
        "cli-failed",
      );
    }
    if (res.status === 400) {
      const text = await res.text();
      if (mode !== "none" && isFormatRejection(text)) {
        continue; // response_format を緩めてリトライ
      }
      throw new AnalysisError(
        `${target.displayName} がリクエストを拒否しました（HTTP 400）: ${text.slice(0, 200)}`,
        "cli-failed",
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AnalysisError(
        `${target.displayName} がエラーを返しました（HTTP ${res.status}）: ${text.slice(0, 200)}`,
        "cli-failed",
      );
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AnalysisError("応答がJSONではありません", "invalid-output");
    }
    const content = getMessageContent(payload);
    if (content === null) {
      throw new AnalysisError(
        "応答の形式が不正です（choices[0].message.content がありません）",
        "invalid-output",
      );
    }
    return { result: extractJson(content), costUSD: null };
  }

  // FORMAT_MODES を使い切ることはない（"none" は 400 でも throw する）
  throw new AnalysisError("応答を取得できませんでした", "cli-failed");
}
