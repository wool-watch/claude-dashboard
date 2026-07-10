import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTranscript } from "@/lib/analysis/transcript";
import { getConfig } from "@/lib/config";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

const config = () => getConfig();

describe("buildTranscript: 基本", () => {
  it("user/assistant を順序どおりに [USER]/[ASSISTANT] 形式へ変換する", () => {
    const t = buildTranscript(fixture("basic-session.jsonl"), config());
    expect(t.text).toBe(
      "[USER] 最初の質問\n\n[ASSISTANT] 回答1\n\n[USER] 次の質問\n\n[ASSISTANT] 回答2",
    );
    expect(t.userTurnCount).toBe(2);
    expect(t.truncated).toBe(false);
  });

  it("blocks 形式の user content も本文を抽出する", () => {
    const jsonl = `${JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "ブロック1" },
          { type: "text", text: "ブロック2" },
        ],
      },
      timestamp: "2026-07-01T00:00:00.000Z",
      isSidechain: false,
    })}\n`;
    const t = buildTranscript(jsonl, config());
    expect(t.text).toBe("[USER] ブロック1\nブロック2");
    expect(t.userTurnCount).toBe(1);
  });

  it("壊れた行はスキップして続行する", () => {
    const jsonl = `not json at all\n${fixture("basic-session.jsonl")}`;
    const t = buildTranscript(jsonl, config());
    expect(t.userTurnCount).toBe(2);
  });
});

describe("buildTranscript: 除外", () => {
  it("サイドチェーンの assistant は含めない", () => {
    const t = buildTranscript(fixture("sidechain.jsonl"), config());
    expect(t.text).toContain("本線の質問");
    expect(t.text).toContain("本線回答");
    expect(t.text).not.toContain("サブエージェント回答");
  });

  it("サイドチェーンのみのJSONLは userTurnCount 0", () => {
    const jsonl = `${JSON.stringify({
      type: "user",
      message: { role: "user", content: "サブエージェントへの指示" },
      timestamp: "2026-07-01T00:00:00.000Z",
      isSidechain: true,
    })}\n`;
    const t = buildTranscript(jsonl, config());
    expect(t.userTurnCount).toBe(0);
    expect(t.text).toBe("");
  });

  it("tool_result のみの user 行は含めない", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "本物の質問" },
        timestamp: "2026-07-01T00:00:00.000Z",
        isSidechain: false,
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1" }],
        },
        timestamp: "2026-07-01T00:00:05.000Z",
        isSidechain: false,
      }),
    ].join("\n");
    const t = buildTranscript(jsonl, config());
    expect(t.userTurnCount).toBe(1);
    expect(t.text).toBe("[USER] 本物の質問");
  });

  it("メタタグ行（<local-command-caveat> 等）は含めない", () => {
    const t = buildTranscript(fixture("misc-records.jsonl"), config());
    expect(t.text).not.toContain("local-command-caveat");
    expect(t.text).toContain("正規の質問");
  });
});

describe("buildTranscript: assistant マージ", () => {
  it("同一 requestId のレコードを1エントリにまとめツール名を列挙する", () => {
    const t = buildTranscript(fixture("duplicate-request-id.jsonl"), config());
    const entries = t.text.split("\n\n");
    const merged = entries.find((e) => e.includes("前半ブロック"));
    expect(merged).toBeDefined();
    expect(merged).toContain("(使用ツール: Read)");
    // 別リクエストは別エントリ
    expect(entries.filter((e) => e.startsWith("[ASSISTANT]"))).toHaveLength(3);
    expect(t.text).toContain("別リクエスト");
    // requestId 欠落時は message.id でマージ
    expect(t.text).toContain("idフォールバック\nidフォールバック続き");
  });

  it("テキストなしツールのみの assistant はツール列挙のみ出す", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "実行して" },
        timestamp: "2026-07-01T00:00:00.000Z",
        isSidechain: false,
      }),
      JSON.stringify({
        type: "assistant",
        requestId: "r1",
        message: {
          id: "m1",
          content: [{ type: "tool_use", id: "t1", name: "Bash" }],
        },
        timestamp: "2026-07-01T00:00:05.000Z",
        isSidechain: false,
      }),
    ].join("\n");
    const t = buildTranscript(jsonl, config());
    expect(t.text).toBe("[USER] 実行して\n\n[ASSISTANT] (使用ツール: Bash)");
  });
});

describe("buildTranscript: サイズ上限", () => {
  const capConfig = (maxChars: number, perMessage: number) => ({
    ...getConfig(),
    transcriptMaxChars: maxChars,
    transcriptMaxCharsPerMessage: perMessage,
  });

  const userLine = (text: string, ts: string) =>
    JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
      timestamp: ts,
      isSidechain: false,
    });

  it("メッセージ単位の上限を超えたら末尾を省略する", () => {
    const jsonl = userLine("あ".repeat(100), "2026-07-01T00:00:00.000Z");
    const t = buildTranscript(jsonl, capConfig(10_000, 20));
    expect(t.text).toContain("あ".repeat(20));
    expect(t.text).not.toContain("あ".repeat(21));
    expect(t.text).toContain("…（省略）");
  });

  it("全体上限を超えたら中間を切除しマーカーを挿入する", () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      userLine(
        `メッセージ${i}: ${"x".repeat(50)}`,
        `2026-07-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      ),
    ).join("\n");
    const t = buildTranscript(lines, capConfig(400, 1_000));
    expect(t.truncated).toBe(true);
    expect(t.text).toContain("（中略");
    expect(t.text.length).toBeLessThanOrEqual(400);
    expect(t.text).toContain("メッセージ0"); // 先頭が残る
    expect(t.text).toContain("メッセージ19"); // 末尾が残る
  });

  it("上限内なら truncated は false", () => {
    const t = buildTranscript(fixture("basic-session.jsonl"), config());
    expect(t.truncated).toBe(false);
  });
});
