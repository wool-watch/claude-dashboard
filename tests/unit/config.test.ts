import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

afterEach(() => {
  delete process.env.MAX_FILE_SIZE_MB;
});

describe("getConfig: maxFileSizeBytes", () => {
  it("既定値は 100MB", () => {
    expect(getConfig().maxFileSizeBytes).toBe(100 * 1024 * 1024);
  });

  it("MAX_FILE_SIZE_MB で上書きできる", () => {
    process.env.MAX_FILE_SIZE_MB = "1";
    expect(getConfig().maxFileSizeBytes).toBe(1024 * 1024);
  });

  it.each(["abc", "0", "-5"])("不正値 %s は既定値にフォールバックする", (raw) => {
    process.env.MAX_FILE_SIZE_MB = raw;
    expect(getConfig().maxFileSizeBytes).toBe(100 * 1024 * 1024);
  });
});
