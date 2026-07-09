import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { buildSession } from "@/lib/domain/session-builder";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import type { SessionDetail } from "@/lib/types";

const build = (fixtureName: string, sessionId = "file-session-id"): SessionDetail => {
  const text = readFileSync(
    fileURLToPath(new URL(`../fixtures/${fixtureName}`, import.meta.url)),
    "utf8",
  );
  const { records, skippedLines } = parseJsonlLines(text);
  return buildSession(records, sessionId, "-home-test-proj", skippedLines, getConfig());
};

describe("buildSession: requestId デデュープ（最重要）", () => {
  const s = build("duplicate-request-id.jsonl");

  it("同一 requestId の usage は1回のみ計上する", () => {
    // rX(100/50) + rY(200/100) + mDup(50/25) — 重複行を二重計上しない
    expect(s.usage.inputTokens).toBe(350);
    expect(s.usage.outputTokens).toBe(175);
  });

  it("requestId 欠落時は message.id でデデュープする", () => {
    const turn2 = s.turns[1];
    expect(turn2.usage.inputTokens).toBe(50);
    expect(turn2.usage.outputTokens).toBe(25);
    expect(turn2.assistantMessageCount).toBe(1);
  });

  it("assistantMessageCount はユニークリクエスト数", () => {
    expect(s.turns[0].assistantMessageCount).toBe(2); // rX, rY
  });

  it("tool_use は重複行に分かれていても id でユニーク化して数える", () => {
    expect(s.turns[0].toolCounts).toEqual({ Read: 1 });
  });
});

describe("buildSession: 正常系（basic-session）", () => {
  const s = build("basic-session.jsonl");

  it("sessionId はファイル名を正とする（レコード内 sessionId は無視）", () => {
    expect(s.sessionId).toBe("file-session-id");
  });

  it("promptId でターン分割する", () => {
    expect(s.turnCount).toBe(2);
    expect(s.turns[0].promptId).toBe("p1");
    expect(s.turns[0].userText).toBe("最初の質問");
    expect(s.turns[1].promptId).toBe("p2");
  });

  it("ai-title をタイトルに採用する", () => {
    expect(s.title).toBe("テストセッション");
  });

  it("セッション合計 usage とコスト（設計書§11.2 の手計算値）", () => {
    expect(s.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 1500,
      cacheWrite5mTokens: 2000,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 3000,
    });
    expect(s.costUSD).toBeCloseTo(0.0665, 9);
    expect(s.costIsEstimated).toBe(false);
  });

  it("操作時間: 全ギャップが閾値以内なら合算（10s+50s+10s=70s）", () => {
    expect(s.activeTimeMs).toBe(70_000);
  });

  it("ターンの時刻と所要時間（turn_duration なしのフォールバック）", () => {
    expect(s.turns[0].startedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(s.turns[0].endedAt).toBe("2026-07-01T00:00:10.000Z");
    expect(s.turns[0].durationMs).toBe(10_000);
  });

  it("cwd / version / gitBranch / モデル / メッセージ数を抽出する", () => {
    expect(s.projectPath).toBe("/home/test/proj-a");
    expect(s.version).toBe("2.1.193");
    expect(s.gitBranch).toBe("main");
    expect(s.models).toEqual(["claude-opus-4-8"]);
    expect(s.messageCount).toBe(4);
    expect(s.sidechainMessageCount).toBe(0);
    expect(s.firstAt).toBe("2026-07-01T00:00:00.000Z");
    expect(s.lastAt).toBe("2026-07-01T00:01:10.000Z");
  });

  it("skippedLines を伝播する", () => {
    expect(s.skippedLines).toBe(0);
  });
});

describe("buildSession: sidechain", () => {
  const s = build("sidechain.jsonl");

  it("sidechain のコストも算入する（重複 requestId はデデュープ）", () => {
    // (1100×$5 + 600×$25) / 1e6 = $0.0205
    expect(s.usage.inputTokens).toBe(1100);
    expect(s.usage.outputTokens).toBe(600);
    expect(s.costUSD).toBeCloseTo(0.0205, 9);
  });

  it("メッセージ数は sidechain を分離して数える（生の行数）", () => {
    expect(s.messageCount).toBe(2); // 本線 user + assistant
    expect(s.sidechainMessageCount).toBe(2); // sidechain assistant 2行
  });

  it("sidechain は新ターンを作らず hasSidechain フラグを立てる", () => {
    expect(s.turnCount).toBe(1);
    expect(s.turns[0].hasSidechain).toBe(true);
  });
});

describe("buildSession: 複数モデル混在", () => {
  const s = build("multi-model.jsonl");

  it("perModelUsage にモデル別で正確に帰属する", () => {
    const t = s.turns[0];
    expect(Object.keys(t.perModelUsage).sort()).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-test-99",
    ]);
    expect(t.perModelUsage["claude-sonnet-4-6"].inputTokens).toBe(1000);
    expect(t.perModelRequests["claude-opus-4-8"]).toBe(1);
  });

  it("コストはモデル別単価で合算し、未知モデルを含むと推定フラグ", () => {
    // (1000×5 + 1000×3 + 1000×5) / 1e6 = 0.013（claude-test-99 は Opus現行フォールバック）
    expect(s.costUSD).toBeCloseTo(0.013, 9);
    expect(s.costIsEstimated).toBe(true);
    expect(s.models).toHaveLength(3);
  });
});

describe("buildSession: キャッシュ変種", () => {
  const s = build("cache-variants.jsonl");

  it("分割あり・なし・usage欠落を正しく合算する", () => {
    expect(s.usage.cacheWrite5mTokens).toBe(400); // 100(分割) + 300(フォールバック)
    expect(s.usage.cacheWrite1hTokens).toBe(200);
    expect(s.usage.inputTokens).toBe(30);
    expect(s.usage.cacheReadTokens).toBe(50);
  });
});

describe("buildSession: 非集計レコード混在（misc-records）", () => {
  const s = build("misc-records.jsonl");

  it("メタタグ user はターンを作らない（turnCount=1）", () => {
    expect(s.turnCount).toBe(1);
    expect(s.turns[0].userText).toBe("正規の質問");
  });

  it("turn_duration レコードの durationMs を優先採用する", () => {
    expect(s.turns[0].durationMs).toBe(5000);
  });

  it("ai-title は後勝ち", () => {
    expect(s.title).toBe("後勝ちタイトル");
  });

  it("メタタグ user もメッセージ数には数える", () => {
    expect(s.messageCount).toBe(3);
  });
});

describe("buildSession: エッジケース（インラインレコード）", () => {
  it("tool_result のみの user は新ターンを開始しない", () => {
    const s = buildSession(
      [
        {
          type: "user",
          promptId: "p1",
          message: { role: "user", content: "質問" },
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-07-01T00:00:00.000Z",
        },
        {
          type: "assistant",
          requestId: "r1",
          message: {
            model: "claude-opus-4-8",
            id: "m1",
            content: [{ type: "tool_use", id: "t1", name: "Bash" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
          uuid: "u2",
          parentUuid: "u1",
          timestamp: "2026-07-01T00:00:05.000Z",
        },
        {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result" }] },
          uuid: "u3",
          parentUuid: "u2",
          timestamp: "2026-07-01T00:00:06.000Z",
        },
        {
          type: "assistant",
          requestId: "r2",
          message: {
            model: "claude-opus-4-8",
            id: "m2",
            content: [{ type: "text", text: "完了" }],
            usage: { input_tokens: 20, output_tokens: 10 },
          },
          uuid: "u4",
          parentUuid: "u3",
          timestamp: "2026-07-01T00:00:10.000Z",
        },
      ],
      "sid",
      "pid",
      0,
      getConfig(),
    );
    expect(s.turnCount).toBe(1);
    expect(s.turns[0].usage.inputTokens).toBe(30);
    expect(s.turns[0].toolCounts).toEqual({ Bash: 1 });
  });

  it("先頭 user より前の assistant は暗黙ターンに帰属する", () => {
    const s = buildSession(
      [
        {
          type: "assistant",
          requestId: "r0",
          message: {
            model: "claude-opus-4-8",
            id: "m0",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-07-01T00:00:00.000Z",
        },
        {
          type: "user",
          promptId: "p1",
          message: { role: "user", content: "本題" },
          uuid: "u2",
          parentUuid: "u1",
          timestamp: "2026-07-01T00:00:10.000Z",
        },
        {
          type: "assistant",
          requestId: "r1",
          message: {
            model: "claude-opus-4-8",
            id: "m1",
            usage: { input_tokens: 200, output_tokens: 100 },
          },
          uuid: "u3",
          parentUuid: "u2",
          timestamp: "2026-07-01T00:00:15.000Z",
        },
      ],
      "sid",
      "pid",
      0,
      getConfig(),
    );
    expect(s.turnCount).toBe(2);
    expect(s.turns[0].promptId).toBeNull();
    expect(s.turns[0].usage.inputTokens).toBe(100);
    expect(s.turns[1].promptId).toBe("p1");
    expect(s.usage.inputTokens).toBe(300);
  });

  it("cwd は最頻値を採用する", () => {
    const mk = (uuid: string, ts: string, cwd: string, promptId: string) => ({
      type: "user" as const,
      promptId,
      message: { role: "user" as const, content: "q" },
      uuid,
      parentUuid: null,
      timestamp: ts,
      cwd,
    });
    const s = buildSession(
      [
        mk("u1", "2026-07-01T00:00:00.000Z", "/path/a", "p1"),
        mk("u2", "2026-07-01T00:00:10.000Z", "/path/b", "p2"),
        mk("u3", "2026-07-01T00:00:20.000Z", "/path/a", "p3"),
      ],
      "sid",
      "pid",
      0,
      getConfig(),
    );
    expect(s.projectPath).toBe("/path/a");
  });

  it("cwd が全欠落なら projectId をそのまま使う", () => {
    const s = buildSession(
      [
        {
          type: "user",
          promptId: "p1",
          message: { role: "user", content: "q" },
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-07-01T00:00:00.000Z",
        },
      ],
      "sid",
      "-encoded-dir-name",
      0,
      getConfig(),
    );
    expect(s.projectPath).toBe("-encoded-dir-name");
  });

  it("ai-title がなければ最初のターンの userText 冒頭をタイトルにする", () => {
    const longText = "あ".repeat(100);
    const s = buildSession(
      [
        {
          type: "user",
          promptId: "p1",
          message: { role: "user", content: `${longText}\n2行目` },
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-07-01T00:00:00.000Z",
        },
      ],
      "sid",
      "pid",
      0,
      getConfig(),
    );
    // 先頭行を titleMaxLength=60 に切詰め
    expect(s.title).toBe(`${"あ".repeat(60)}…`);
  });

  it("userText は 200 字に切り詰める", () => {
    const s = buildSession(
      [
        {
          type: "user",
          promptId: "p1",
          message: { role: "user", content: "x".repeat(300) },
          uuid: "u1",
          parentUuid: null,
          timestamp: "2026-07-01T00:00:00.000Z",
        },
      ],
      "sid",
      "pid",
      0,
      getConfig(),
    );
    expect(s.turns[0].userText).toBe(`${"x".repeat(200)}…`);
  });

  it("known レコードが1件もないファイルでもクラッシュしない", () => {
    const s = buildSession(
      [{ type: "mode" }, { type: "attachment" }],
      "sid",
      "pid",
      2,
      getConfig(),
    );
    expect(s.turnCount).toBe(0);
    expect(s.messageCount).toBe(0);
    expect(s.costUSD).toBe(0);
    expect(s.title).toBeNull();
    expect(s.skippedLines).toBe(2);
  });
});
