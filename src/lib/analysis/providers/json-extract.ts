import { AnalysisError } from "@/lib/analysis/errors";

/** 「```json ... ```」等のコードフェンスを剥がす */
export function stripCodeFence(s: string): string {
  const m = /^\s*```[a-z]*\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(s);
  return m !== null ? m[1] : s;
}

/**
 * 自由テキストの応答から JSON オブジェクトを取り出す。
 * 構造化出力を保証できないプロバイダ（gemini や json_schema 非対応モデル）向け。
 * 1. コードフェンスを剥がしてそのままパース
 * 2. 失敗したら「最初の { から最後の } まで」を抽出してパース
 */
export function extractJson(text: string): unknown {
  const stripped = stripCodeFence(text.trim()).trim();
  try {
    return JSON.parse(stripped);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(stripCodeFence(text.slice(start, end + 1)));
    } catch {}
  }
  throw new AnalysisError(
    `応答からJSONを抽出できません: ${text.slice(0, 200)}`,
    "invalid-output",
  );
}
