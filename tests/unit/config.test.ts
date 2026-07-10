import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

afterEach(() => {
  delete process.env.MAX_FILE_SIZE_MB;
  delete process.env.CLAUDE_ARCHIVE_DIR;
  delete process.env.CLAUDE_SETTINGS_PATH;
  delete process.env.ARCHIVE_SYNC_INTERVAL_MS;
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

describe("getConfig: archiveDir", () => {
  it("既定値は ~/.claude-dashboard/archive", () => {
    expect(getConfig().archiveDir).toBe(
      path.join(os.homedir(), ".claude-dashboard", "archive"),
    );
  });

  it("CLAUDE_ARCHIVE_DIR で上書きできる", () => {
    process.env.CLAUDE_ARCHIVE_DIR = "/tmp/custom-archive";
    expect(getConfig().archiveDir).toBe("/tmp/custom-archive");
  });
});

describe("getConfig: settingsPath", () => {
  it("既定値は ~/.claude-dashboard/settings.json", () => {
    expect(getConfig().settingsPath).toBe(
      path.join(os.homedir(), ".claude-dashboard", "settings.json"),
    );
  });

  it("CLAUDE_SETTINGS_PATH で上書きできる", () => {
    process.env.CLAUDE_SETTINGS_PATH = "/tmp/custom-settings.json";
    expect(getConfig().settingsPath).toBe("/tmp/custom-settings.json");
  });
});

describe("getConfig: archiveSyncIntervalMs", () => {
  it("既定値は 5分", () => {
    expect(getConfig().archiveSyncIntervalMs).toBe(5 * 60 * 1000);
  });

  it("ARCHIVE_SYNC_INTERVAL_MS で上書きできる", () => {
    process.env.ARCHIVE_SYNC_INTERVAL_MS = "5000";
    expect(getConfig().archiveSyncIntervalMs).toBe(5000);
  });

  it.each(["abc", "0", "-100"])(
    "不正値 %s は既定値にフォールバックする",
    (raw) => {
      process.env.ARCHIVE_SYNC_INTERVAL_MS = raw;
      expect(getConfig().archiveSyncIntervalMs).toBe(5 * 60 * 1000);
    },
  );
});
