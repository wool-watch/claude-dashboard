import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import {
  extractAssistantText,
  extractToolUses,
  extractUserText,
  isAiTitleRecord,
  isAssistantRecord,
  isToolResultOnly,
  isTurnDurationRecord,
  isUserRecord,
  normalizeUsage,
} from "@/lib/parser/records";
import type { RawContentBlock } from "@/lib/types";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

describe("parseJsonlLines", () => {
  it("正常な JSONL を全行パースする（skipped=0）", () => {
    const { records, skippedLines } = parseJsonlLines(
      fixture("basic-session.jsonl"),
    );
    expect(records).toHaveLength(5);
    expect(skippedLines).toBe(0);
  });

  it("不正JSON行・非オブジェクト行はスキップしてカウントする（空行はカウント外）", () => {
    // 壊れJSON 2行 + 裸の文字列 1行 = skipped 3。空行 2 行はカウントしない
    const { records, skippedLines } = parseJsonlLines(
      fixture("broken-lines.jsonl"),
    );
    expect(records).toHaveLength(2);
    expect(skippedLines).toBe(3);
  });

  it("空文字列・改行のみの入力は空結果を返す", () => {
    expect(parseJsonlLines("")).toEqual({ records: [], skippedLines: 0 });
    expect(parseJsonlLines("\n\n\n")).toEqual({ records: [], skippedLines: 0 });
  });

  it("先頭 BOM を除去してパースする", () => {
    const { records, skippedLines } = parseJsonlLines(
      '﻿{"type":"user"}\n',
    );
    expect(records).toHaveLength(1);
    expect(skippedLines).toBe(0);
  });

  it("null や数値だけの行はオブジェクトでないためスキップ", () => {
    const { records, skippedLines } = parseJsonlLines("null\n42\n{}\n");
    expect(records).toHaveLength(1);
    expect(skippedLines).toBe(2);
  });
});

describe("型ガード", () => {
  const basic = parseJsonlLines(fixture("basic-session.jsonl")).records;

  it("isUserRecord: user レコードを判別する", () => {
    expect(basic.filter(isUserRecord)).toHaveLength(2);
    expect(isUserRecord({ type: "user" })).toBe(false); // message 欠落
    expect(
      isUserRecord({
        type: "user",
        message: { role: "user", content: "x" },
        timestamp: "2026-01-01T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("isAssistantRecord: assistant レコードを判別する（usage 欠落も許容）", () => {
    expect(basic.filter(isAssistantRecord)).toHaveLength(2);
    expect(
      isAssistantRecord({
        type: "assistant",
        message: {},
        timestamp: "2026-01-01T00:00:00Z",
      }),
    ).toBe(true);
    expect(isAssistantRecord({ type: "assistant" })).toBe(false);
  });

  it("isAiTitleRecord: aiTitle が非空文字列のときのみ true", () => {
    expect(basic.filter(isAiTitleRecord)).toHaveLength(1);
    expect(isAiTitleRecord({ type: "ai-title", aiTitle: "" })).toBe(false);
    expect(isAiTitleRecord({ type: "ai-title" })).toBe(false);
  });

  it("isTurnDurationRecord: system/turn_duration を判別する", () => {
    expect(
      isTurnDurationRecord({
        type: "system",
        subtype: "turn_duration",
        durationMs: 5000,
        timestamp: "2026-01-01T00:00:00Z",
        parentUuid: null,
      }),
    ).toBe(true);
    expect(
      isTurnDurationRecord({ type: "system", subtype: "scheduled_task_fire" }),
    ).toBe(false);
    expect(
      isTurnDurationRecord({
        type: "system",
        subtype: "turn_duration",
        durationMs: Number.NaN,
      }),
    ).toBe(false);
  });

  it("未知タイプ（mode, attachment 等）はどのガードにも一致しない", () => {
    for (const r of [
      { type: "mode", mode: "default" },
      { type: "attachment" },
      { type: "file-history-snapshot" },
      { type: "summary", summary: "x" },
    ]) {
      expect(isUserRecord(r)).toBe(false);
      expect(isAssistantRecord(r)).toBe(false);
      expect(isAiTitleRecord(r)).toBe(false);
      expect(isTurnDurationRecord(r)).toBe(false);
    }
  });
});

describe("normalizeUsage", () => {
  it("cache_creation 分割ありのとき 5m/1h を分けて取り込む", () => {
    expect(
      normalizeUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 400,
        cache_creation: {
          ephemeral_5m_input_tokens: 100,
          ephemeral_1h_input_tokens: 200,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheWrite5mTokens: 100,
      cacheWrite1hTokens: 200,
      cacheReadTokens: 400,
    });
  });

  it("cache_creation なしのとき cache_creation_input_tokens 全量を 5m 扱いにする", () => {
    expect(
      normalizeUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 300,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheWrite5mTokens: 300,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("usage 未定義は全ゼロ", () => {
    expect(normalizeUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("非有限値は 0 に落とす", () => {
    expect(
      normalizeUsage({
        input_tokens: Number.NaN,
        output_tokens: 5,
      }).inputTokens,
    ).toBe(0);
  });
});

describe("content ユーティリティ", () => {
  const blocks: RawContentBlock[] = [
    { type: "thinking", text: "思考" },
    { type: "text", text: "こんにちは" },
    { type: "tool_use", id: "toolu_1", name: "Read" },
    { type: "tool_use", id: "toolu_2", name: "Bash" },
  ];

  it("extractToolUses: tool_use ブロックの id と name を抽出する", () => {
    expect(extractToolUses(blocks)).toEqual([
      { id: "toolu_1", name: "Read" },
      { id: "toolu_2", name: "Bash" },
    ]);
    expect(extractToolUses(undefined)).toEqual([]);
  });

  it("extractUserText: 文字列はそのまま、配列は text ブロックを連結", () => {
    expect(extractUserText("そのまま")).toBe("そのまま");
    expect(
      extractUserText([
        { type: "text", text: "前半" },
        { type: "tool_result", text: "無視される" },
        { type: "text", text: "後半" },
      ]),
    ).toBe("前半\n後半");
    expect(extractUserText([{ type: "tool_result" }])).toBe("");
  });

  it("extractAssistantText: text ブロックのみ改行で連結、undefined は空文字", () => {
    expect(
      extractAssistantText([
        { type: "text", text: "回答前半" },
        { type: "tool_use", id: "t1", name: "Bash" },
        { type: "text", text: "回答後半" },
      ]),
    ).toBe("回答前半\n回答後半");
    expect(extractAssistantText(undefined)).toBe("");
    expect(extractAssistantText([{ type: "tool_use", id: "t1", name: "Bash" }])).toBe("");
  });

  it("isToolResultOnly: 全ブロックが tool_result のときのみ true", () => {
    expect(isToolResultOnly([{ type: "tool_result" }])).toBe(true);
    expect(
      isToolResultOnly([{ type: "tool_result" }, { type: "text", text: "x" }]),
    ).toBe(false);
    expect(isToolResultOnly("文字列")).toBe(false);
    expect(isToolResultOnly([])).toBe(true); // 防御的に非ターン扱い
  });
});
