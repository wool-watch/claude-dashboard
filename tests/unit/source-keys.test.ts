import { describe, expect, it } from "vitest";
import {
  fileStemToSessionKey,
  formatSessionKey,
  parseSessionKey,
  sessionKeyToFileStem,
} from "@/lib/sources/keys";

const UUID = "0f79ad9e-46a8-4f13-a748-8e2ba2a13bc7";

describe("formatSessionKey", () => {
  it("claude は素の sessionId のまま（既存URL・分析ファイル互換）", () => {
    expect(formatSessionKey("claude", UUID)).toBe(UUID);
  });

  it("codex / gemini は <source>:<id> 形式", () => {
    expect(formatSessionKey("codex", UUID)).toBe(`codex:${UUID}`);
    expect(formatSessionKey("gemini", "session-abc_1")).toBe(
      "gemini:session-abc_1",
    );
  });
});

describe("parseSessionKey", () => {
  it("素のUUIDは claude として解決する", () => {
    expect(parseSessionKey(UUID)).toEqual({
      source: "claude",
      sessionId: UUID,
    });
  });

  it("プレフィックス付きキーを分解する", () => {
    expect(parseSessionKey(`codex:${UUID}`)).toEqual({
      source: "codex",
      sessionId: UUID,
    });
    expect(parseSessionKey("gemini:session-abc_1")).toEqual({
      source: "gemini",
      sessionId: "session-abc_1",
    });
  });

  it("UUIDでもプレフィックス付きでもない文字列は null", () => {
    expect(parseSessionKey("not-a-session")).toBeNull();
    expect(parseSessionKey("")).toBeNull();
  });

  it("未知ソースのプレフィックスは null", () => {
    expect(parseSessionKey(`cursor:${UUID}`)).toBeNull();
  });

  it("id が空のキーは null", () => {
    expect(parseSessionKey("codex:")).toBeNull();
  });

  it("パストラバーサルになりうる id は拒否する", () => {
    expect(parseSessionKey("codex:../etc/passwd")).toBeNull();
    expect(parseSessionKey("gemini:a/b")).toBeNull();
    expect(parseSessionKey("codex:a..b")).toBeNull();
  });
});

describe("sessionKeyToFileStem / fileStemToSessionKey", () => {
  it("claude はUUIDそのまま、他ソースは <source>-- 接頭辞（: はファイル名で不可）", () => {
    expect(sessionKeyToFileStem(UUID)).toBe(UUID);
    expect(sessionKeyToFileStem(`codex:${UUID}`)).toBe(`codex--${UUID}`);
    expect(sessionKeyToFileStem("gemini:session-abc_1")).toBe(
      "gemini--session-abc_1",
    );
  });

  it("不正なキーは null", () => {
    expect(sessionKeyToFileStem("cursor:abc")).toBeNull();
    expect(sessionKeyToFileStem("not-a-session")).toBeNull();
  });

  it("ファイル名 stem からキーへ復元できる（ラウンドトリップ）", () => {
    for (const key of [UUID, `codex:${UUID}`, "gemini:session-abc_1"]) {
      const stem = sessionKeyToFileStem(key);
      expect(stem).not.toBeNull();
      expect(fileStemToSessionKey(stem as string)).toBe(key);
    }
  });

  it("id に -- を含んでも最初の区切りだけで分解する", () => {
    expect(fileStemToSessionKey("gemini--a--b")).toBe("gemini:a--b");
  });

  it("未知の stem は null", () => {
    expect(fileStemToSessionKey("cursor--abc")).toBeNull();
    expect(fileStemToSessionKey("not-a-session")).toBeNull();
  });
});
