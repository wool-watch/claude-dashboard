import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { buildSession } from "@/lib/domain/session-builder";
import { isAssistantRecord, isUserRecord } from "@/lib/parser/records";
import { parseCodexRollout } from "@/lib/sources/codex/parser";
import type { SessionDetail, UserRecord } from "@/lib/types";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

const buildFromFixture = (name: string, sessionId = "codex-session-1"): SessionDetail => {
  const { records, skippedLines, overrides } = parseCodexRollout(fixture(name));
  return buildSession(records, sessionId, "-home-test-proj", skippedLines, getConfig(), {
    source: "codex",
    overrides,
  });
};

describe("parseCodexRollout: 基本（実データ由来フィクスチャ）", () => {
  const s = buildFromFixture("codex-basic-rollout.jsonl");

  it("turn_context の turn_id でターン分割される", () => {
    expect(s.turnCount).toBe(2);
    expect(s.turns[0].promptId).toBe("turn-1");
    expect(s.turns[1].promptId).toBe("turn-2");
    expect(s.turns[0].userText).toBe("最初の質問");
    expect(s.turns[1].userText).toBe("次の質問");
  });

  it("task_complete の duration_ms がターン所要時間になる", () => {
    expect(s.turns[0].durationMs).toBe(20000);
    expect(s.turns[1].durationMs).toBe(5000);
  });

  it("token_count の last_token_usage をリクエスト単位で計上する（input は cached を除く）", () => {
    // req1: 1000-600=400 / cacheRead 600 / out 50、req2: 1200-1000=200 / 1000 / 80
    expect(s.turns[0].usage.inputTokens).toBe(600);
    expect(s.turns[0].usage.cacheReadTokens).toBe(1600);
    expect(s.turns[0].usage.outputTokens).toBe(130);
    expect(s.turns[0].usage.cacheWrite5mTokens).toBe(0);
    expect(s.turns[1].usage.inputTokens).toBe(500);
    expect(s.turns[1].usage.cacheReadTokens).toBe(1500);
    expect(s.turns[1].usage.outputTokens).toBe(120);
  });

  it("assistantMessageCount は token_count（APIリクエスト）単位", () => {
    expect(s.turns[0].assistantMessageCount).toBe(2);
    expect(s.turns[1].assistantMessageCount).toBe(1);
  });

  it("モデルは turn_context から取得する", () => {
    expect(s.models).toEqual(["gpt-5.6-terra"]);
  });

  it("custom_tool_call はツールとして数える", () => {
    expect(s.turns[0].toolCounts).toEqual({ exec: 1 });
  });

  it("session_meta が projectPath / version / gitBranch を確定する", () => {
    expect(s.projectPath).toBe("/home/test/proj");
    expect(s.version).toBe("0.144.1");
    expect(s.gitBranch).toBe("main");
  });

  it("AGENTS.md / environment_context / developer ロールは会話に含めない", () => {
    expect(s.title).toBe("最初の質問");
    // 非メタ user 3（質問2 + tool_result 1）+ assistant 4（テキスト3 + tool_call 1）
    expect(s.messageCount).toBe(7);
  });

  it("source と sessionKey が付与される", () => {
    expect(s.source).toBe("codex");
    expect(s.sessionKey).toBe("codex:codex-session-1");
  });
});

describe("parseCodexRollout: apply_patch / shell / 中断 / 寛容性", () => {
  const parsed = parseCodexRollout(fixture("codex-apply-patch.jsonl"));
  const s = buildSession(
    parsed.records,
    "codex-session-2",
    "-p",
    parsed.skippedLines,
    getConfig(),
    { source: "codex", overrides: parsed.overrides },
  );

  it("JSONとして壊れた行のみ skippedLines に数える（未知タイプは無視）", () => {
    expect(parsed.skippedLines).toBe(1);
  });

  it("function_call / local_shell_call をツールとして数える", () => {
    expect(s.turns[0].toolCounts).toEqual({ apply_patch: 1, shell: 1 });
  });

  it("turn_aborted は中断テキストとして現行ターンに帰属する（新ターンを作らない）", () => {
    expect(s.turnCount).toBe(1);
    const interrupted = parsed.records.filter(
      (r): r is UserRecord =>
        isUserRecord(r) &&
        typeof r.message.content === "string" &&
        r.message.content.startsWith("[Request interrupted"),
    );
    expect(interrupted).toHaveLength(1);
  });

  it("last_token_usage 欠落時は total_token_usage の差分で計上する", () => {
    // req1: 500-0=500/0/20、req2: (900-500)-(100-0)=300 / 100 / 30
    expect(s.turns[0].usage.inputTokens).toBe(800);
    expect(s.turns[0].usage.cacheReadTokens).toBe(100);
    expect(s.turns[0].usage.outputTokens).toBe(50);
    expect(s.turns[0].assistantMessageCount).toBe(2);
  });

  it("function_call_output の exit_code から is_error を判定する", () => {
    const results = parsed.records
      .filter(isUserRecord)
      .flatMap((r) =>
        Array.isArray(r.message.content)
          ? r.message.content.filter((b) => b.type === "tool_result")
          : [],
      );
    const byId = new Map(results.map((b) => [b.tool_use_id, b.is_error]));
    expect(byId.get("call_p1")).toBe(false);
    expect(byId.get("call_s1")).toBe(true);
  });

  it("apply_patch の入力はパース済みJSONとして保持する", () => {
    const tools = parsed.records
      .filter(isAssistantRecord)
      .flatMap((r) => r.message.content ?? [])
      .filter((b) => b.type === "tool_use" && b.name === "apply_patch");
    expect(tools).toHaveLength(1);
    expect((tools[0].input as { input: string }).input).toContain(
      "*** Update File: src/a.ts",
    );
  });

  it("git 情報がない session_meta は gitBranch null", () => {
    expect(s.gitBranch).toBeNull();
    expect(s.projectPath).toBe("/home/test/proj2");
  });

  it("既知モデル gpt-5-codex はコスト確定（isEstimated false）", () => {
    expect(s.costIsEstimated).toBe(false);
    expect(s.models).toEqual(["gpt-5-codex"]);
  });
});

describe("parseCodexRollout: 空・破損入力", () => {
  it("空文字列はレコード0件", () => {
    const { records, skippedLines } = parseCodexRollout("");
    expect(records).toHaveLength(0);
    expect(skippedLines).toBe(0);
  });

  it("全行破損でも例外を投げない", () => {
    const { records, skippedLines } = parseCodexRollout("xxx\nyyy\n");
    expect(records).toHaveLength(0);
    expect(skippedLines).toBe(2);
  });
});
