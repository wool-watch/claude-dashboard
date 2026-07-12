import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { buildSession } from "@/lib/domain/session-builder";
import { isUserRecord } from "@/lib/parser/records";
import { parseGeminiChat } from "@/lib/sources/gemini/parser";
import type { SessionDetail } from "@/lib/types";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

const buildFromContent = (content: string): SessionDetail => {
  const { records, skippedLines, overrides, sessionId } =
    parseGeminiChat(content);
  return buildSession(
    records,
    sessionId ?? "gemini-fallback-id",
    "-p",
    skippedLines,
    getConfig(),
    { source: "gemini", overrides },
  );
};

describe("parseGeminiChat: 基本（JSONL形式）", () => {
  const parsed = parseGeminiChat(fixture("gemini-basic-chat.jsonl"));
  const s = buildFromContent(fixture("gemini-basic-chat.jsonl"));

  it("メタデータ行から sessionId を取得する", () => {
    expect(parsed.sessionId).toBe("3f2b8c1d-aaaa-bbbb-cccc-0123456789ab");
  });

  it("user メッセージごとにターンが分かれる", () => {
    expect(s.turnCount).toBe(2);
    expect(s.turns[0].userText).toBe("最初の質問");
    expect(s.turns[1].userText).toBe("次の質問");
  });

  it("tokens を usage へ変換する（input は cached を除き、thoughts は output に含む）", () => {
    // m2: (1000-600)/600/(50+10), m3: (1200-1000)/1000/80
    expect(s.turns[0].usage.inputTokens).toBe(600);
    expect(s.turns[0].usage.cacheReadTokens).toBe(1600);
    expect(s.turns[0].usage.outputTokens).toBe(140);
    // m6: (2000-1500)/1500/120
    expect(s.turns[1].usage.inputTokens).toBe(500);
    expect(s.turns[1].usage.cacheReadTokens).toBe(1500);
    expect(s.turns[1].usage.outputTokens).toBe(120);
  });

  it("メッセージ単位でモデルを取得する", () => {
    expect(s.models).toEqual(["gemini-2.5-pro", "gemini-3-flash"]);
  });

  it("toolCalls を tool_use として数え、status からエラー判定する", () => {
    expect(s.turns[0].toolCounts).toEqual({
      write_file: 1,
      run_shell_command: 1,
    });
    const results = parsed.records
      .filter(isUserRecord)
      .flatMap((r) =>
        Array.isArray(r.message.content)
          ? r.message.content.filter((b) => b.type === "tool_result")
          : [],
      );
    const byId = new Map(results.map((b) => [b.tool_use_id, b.is_error]));
    expect(byId.get("tc1")).toBe(false);
    expect(byId.get("tc2")).toBe(true);
  });

  it("$set の summary をタイトルとして採用する", () => {
    expect(s.title).toBe("ダッシュボードの改善相談");
  });

  it("info 等の非会話メッセージは無視する", () => {
    // 非メタ user 2 + tool_result 1 + assistant 3
    expect(s.messageCount).toBe(6);
  });

  it("source / sessionKey / 推定コストではない既知モデル", () => {
    expect(s.source).toBe("gemini");
    expect(s.costIsEstimated).toBe(false);
  });
});

describe("parseGeminiChat: 巻き戻し・破損・未知レコード", () => {
  const content = fixture("gemini-malformed.jsonl");
  const parsed = parseGeminiChat(content);
  const s = buildFromContent(content);

  it("破損行のみ skippedLines に数える（未知タイプは無視）", () => {
    expect(parsed.skippedLines).toBe(1);
  });

  it("$rewindTo は対象メッセージ以降を破棄する", () => {
    expect(s.turnCount).toBe(2);
    expect(s.turns[0].userText).toBe("質問1");
    expect(s.turns[1].userText).toBe("質問2やりなおし");
    // 巻き戻された m3/m4 の usage は計上しない
    expect(s.usage.inputTokens).toBe(100 + 200);
    expect(s.usage.outputTokens).toBe(40);
  });
});

describe("parseGeminiChat: 旧形式（単一JSONオブジェクト）", () => {
  it("messages 配列を持つ ConversationRecord 全体を受け付ける", () => {
    const legacy = JSON.stringify({
      sessionId: "5a5b6c7d-1111-2222-3333-444455556666",
      projectHash: "h",
      startTime: "2026-07-01T00:00:00.000Z",
      messages: [
        { id: "m1", timestamp: "2026-07-01T00:00:01.000Z", type: "user", content: "旧形式の質問" },
        {
          id: "m2",
          timestamp: "2026-07-01T00:00:05.000Z",
          type: "gemini",
          model: "gemini-2.5-pro",
          content: "旧形式の回答",
          tokens: { input: 10, output: 5, cached: 0, total: 15 },
        },
      ],
    });
    const s = buildFromContent(legacy);
    expect(s.turnCount).toBe(1);
    expect(s.turns[0].userText).toBe("旧形式の質問");
    expect(s.usage.outputTokens).toBe(5);
  });

  it("整形済み（複数行）JSONも受け付ける", () => {
    const pretty = JSON.stringify(
      {
        sessionId: "6a5b6c7d-1111-2222-3333-444455556666",
        messages: [
          { id: "m1", timestamp: "2026-07-01T00:00:01.000Z", type: "user", content: "整形済み" },
        ],
      },
      null,
      2,
    );
    const parsed = parseGeminiChat(pretty);
    expect(parsed.sessionId).toBe("6a5b6c7d-1111-2222-3333-444455556666");
    expect(parsed.records.filter(isUserRecord)).toHaveLength(1);
    expect(parsed.skippedLines).toBe(0);
  });

  it("空文字列はレコード0件", () => {
    const { records, skippedLines } = parseGeminiChat("");
    expect(records).toHaveLength(0);
    expect(skippedLines).toBe(0);
  });
});
