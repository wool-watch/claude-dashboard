import { describe, expect, it } from "vitest";
import { addUsage, emptyUsage, totalTokens } from "@/lib/types";
import { getConfig } from "@/lib/config";

describe("スキャフォールド確認", () => {
  it("emptyUsage は全ゼロを返す", () => {
    expect(totalTokens(emptyUsage())).toBe(0);
  });

  it("addUsage はフィールド毎に加算する", () => {
    const a = { ...emptyUsage(), inputTokens: 100, cacheReadTokens: 50 };
    const b = { ...emptyUsage(), inputTokens: 200, outputTokens: 30 };
    expect(addUsage(a, b)).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 50,
    });
  });

  it("getConfig は CLAUDE_DATA_DIR を反映する", () => {
    const prev = process.env.CLAUDE_DATA_DIR;
    process.env.CLAUDE_DATA_DIR = "/tmp/fixture-dir";
    try {
      expect(getConfig().dataDir).toBe("/tmp/fixture-dir");
      expect(getConfig().idleThresholdMs).toBe(5 * 60 * 1000);
      expect(getConfig().weekStartsOn).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_DATA_DIR;
      else process.env.CLAUDE_DATA_DIR = prev;
    }
  });
});
