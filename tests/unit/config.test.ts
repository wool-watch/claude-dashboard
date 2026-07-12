import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

// 既定値の検証はグローバル環境ガード（tests/setup-env-guard.ts）が入れる値も
// 邪魔になるため、各テストの前後で env を空にする。
// getConfig は env を読むだけで FS に触れないため、実データに影響しない
const clearEnv = () => {
  delete process.env.MAX_FILE_SIZE_MB;
  delete process.env.CLAUDE_DATA_DIR;
  delete process.env.CLAUDE_ARCHIVE_DIR;
  delete process.env.CLAUDE_SETTINGS_PATH;
  delete process.env.ARCHIVE_SYNC_INTERVAL_MS;
  delete process.env.CLAUDE_ANALYSIS_DIR;
  delete process.env.CLAUDE_CLI_PATH;
  delete process.env.ANALYSIS_TIMEOUT_MS;
  delete process.env.ANALYSIS_MAX_BUDGET_USD;
  delete process.env.CODEX_DATA_DIR;
  delete process.env.CODEX_ARCHIVED_DIR;
  delete process.env.GEMINI_DATA_DIR;
};

beforeEach(clearEnv);
afterEach(clearEnv);

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

describe("getConfig: analysisDir", () => {
  it("既定値は ~/.claude-dashboard/analysis", () => {
    expect(getConfig().analysisDir).toBe(
      path.join(os.homedir(), ".claude-dashboard", "analysis"),
    );
  });

  it("CLAUDE_ANALYSIS_DIR で上書きできる", () => {
    process.env.CLAUDE_ANALYSIS_DIR = "/tmp/custom-analysis";
    expect(getConfig().analysisDir).toBe("/tmp/custom-analysis");
  });
});

describe("getConfig: claudeCliPath", () => {
  it("既定値は claude", () => {
    expect(getConfig().claudeCliPath).toBe("claude");
  });

  it("CLAUDE_CLI_PATH で上書きできる", () => {
    process.env.CLAUDE_CLI_PATH = "/opt/bin/claude";
    expect(getConfig().claudeCliPath).toBe("/opt/bin/claude");
  });
});

describe("getConfig: analysisTimeoutMs", () => {
  it("既定値は 180秒", () => {
    expect(getConfig().analysisTimeoutMs).toBe(180 * 1000);
  });

  it("ANALYSIS_TIMEOUT_MS で上書きできる", () => {
    process.env.ANALYSIS_TIMEOUT_MS = "200";
    expect(getConfig().analysisTimeoutMs).toBe(200);
  });

  it.each(["abc", "0", "-1"])("不正値 %s は既定値にフォールバックする", (raw) => {
    process.env.ANALYSIS_TIMEOUT_MS = raw;
    expect(getConfig().analysisTimeoutMs).toBe(180 * 1000);
  });
});

describe("getConfig: analysisMaxBudgetUsd", () => {
  it("既定値は 1", () => {
    expect(getConfig().analysisMaxBudgetUsd).toBe(1);
  });

  it("ANALYSIS_MAX_BUDGET_USD で上書きできる", () => {
    process.env.ANALYSIS_MAX_BUDGET_USD = "0.5";
    expect(getConfig().analysisMaxBudgetUsd).toBe(0.5);
  });

  it.each(["abc", "0", "-1"])("不正値 %s は既定値にフォールバックする", (raw) => {
    process.env.ANALYSIS_MAX_BUDGET_USD = raw;
    expect(getConfig().analysisMaxBudgetUsd).toBe(1);
  });
});

describe("getConfig: マルチCLIソースのディレクトリ", () => {
  it("codexDataDir の既定値は ~/.codex/sessions", () => {
    expect(getConfig().codexDataDir).toBe(
      path.join(os.homedir(), ".codex", "sessions"),
    );
  });

  it("codexArchivedDir の既定値は ~/.codex/archived_sessions", () => {
    expect(getConfig().codexArchivedDir).toBe(
      path.join(os.homedir(), ".codex", "archived_sessions"),
    );
  });

  it("geminiDataDir の既定値は ~/.gemini/tmp", () => {
    expect(getConfig().geminiDataDir).toBe(
      path.join(os.homedir(), ".gemini", "tmp"),
    );
  });

  it("環境変数で上書きできる", () => {
    process.env.CODEX_DATA_DIR = "/tmp/codex-sessions";
    process.env.CODEX_ARCHIVED_DIR = "/tmp/codex-archived";
    process.env.GEMINI_DATA_DIR = "/tmp/gemini-tmp";
    const config = getConfig();
    expect(config.codexDataDir).toBe("/tmp/codex-sessions");
    expect(config.codexArchivedDir).toBe("/tmp/codex-archived");
    expect(config.geminiDataDir).toBe("/tmp/gemini-tmp");
  });
});

describe("getConfig: トランスクリプト上限", () => {
  it("全体 40,000字・メッセージ単位 2,000字", () => {
    expect(getConfig().transcriptMaxChars).toBe(40_000);
    expect(getConfig().transcriptMaxCharsPerMessage).toBe(2_000);
  });
});
