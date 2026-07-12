import { readFileSync } from "node:fs";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import type { SessionSourceId } from "@/lib/sources/types";

export interface LoadedSessionRecords {
  records: unknown[];
  skippedLines: number;
}

/**
 * セッションファイルをソース別にパースして正規化レコード配列を返す。
 * session-builder / metrics / transcript はこの結果を共通に消費する。
 */
export function loadSessionRecords(
  filePath: string,
  source: SessionSourceId,
): LoadedSessionRecords {
  const content = readFileSync(filePath, "utf8");
  return parseSessionContent(content, source);
}

export function parseSessionContent(
  content: string,
  source: SessionSourceId,
): LoadedSessionRecords {
  switch (source) {
    // codex / gemini のアダプタは後続マイルストーンで実装する
    case "claude":
    default:
      return parseJsonlLines(content);
  }
}
