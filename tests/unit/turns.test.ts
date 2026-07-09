import { describe, expect, it } from "vitest";
import { isTurnTrigger, META_TAG_PREFIXES } from "@/lib/domain/turns";
import type { UserRecord } from "@/lib/types";

const user = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  type: "user",
  message: { role: "user", content: "普通の質問" },
  uuid: "u1",
  parentUuid: null,
  timestamp: "2026-07-01T00:00:00.000Z",
  isSidechain: false,
  ...overrides,
});

describe("isTurnTrigger", () => {
  it("通常の文字列プロンプトはターン開始", () => {
    expect(isTurnTrigger(user())).toBe(true);
  });

  it("isSidechain=true はターン開始しない", () => {
    expect(isTurnTrigger(user({ isSidechain: true }))).toBe(false);
  });

  it("isMeta=true はターン開始しない", () => {
    expect(isTurnTrigger(user({ isMeta: true }))).toBe(false);
  });

  it("tool_result のみの content はターン開始しない", () => {
    expect(
      isTurnTrigger(
        user({
          message: { role: "user", content: [{ type: "tool_result" }] },
        }),
      ),
    ).toBe(false);
  });

  it("空配列 content はターン開始しない", () => {
    expect(
      isTurnTrigger(user({ message: { role: "user", content: [] } })),
    ).toBe(false);
  });

  it("text ブロックを含む配列 content はターン開始", () => {
    expect(
      isTurnTrigger(
        user({
          message: {
            role: "user",
            content: [
              { type: "tool_result" },
              { type: "text", text: "続けて" },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it.each(META_TAG_PREFIXES)(
    "メタタグ %s で始まる文字列はターン開始しない",
    (prefix) => {
      expect(
        isTurnTrigger(
          user({
            message: { role: "user", content: `${prefix}中身...` },
          }),
        ),
      ).toBe(false);
    },
  );

  it("メタタグ一覧に local-command-caveat が含まれる", () => {
    expect(META_TAG_PREFIXES).toContain("<local-command-caveat>");
  });
});
