export interface ParseResult {
  records: unknown[];
  skippedLines: number;
}

/**
 * JSONL テキストを行単位でパースする。
 * 不正JSON行・非オブジェクト行はカウントのみしてスキップ（寛容設計）。
 * 空行はスキップ対象だがカウントしない。
 */
export function parseJsonlLines(text: string): ParseResult {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: unknown[] = [];
  let skippedLines = 0;

  for (const rawLine of stripped.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        records.push(parsed);
      } else {
        skippedLines++;
      }
    } catch {
      skippedLines++;
    }
  }

  return { records, skippedLines };
}
