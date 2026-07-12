import os from "node:os";
import path from "node:path";

export interface DashboardConfig {
  dataDir: string;
  archiveDir: string;
  settingsPath: string;
  archiveSyncIntervalMs: number;
  analysisDir: string;
  claudeCliPath: string;
  codexDataDir: string;
  codexArchivedDir: string;
  geminiDataDir: string;
  analysisTimeoutMs: number;
  analysisMaxBudgetUsd: number;
  transcriptMaxChars: number;
  transcriptMaxCharsPerMessage: number;
  idleThresholdMs: number;
  maxFileSizeBytes: number;
  weekStartsOn: 1;
  userTextMaxLength: number;
  titleMaxLength: number;
}

const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FILE_SIZE_MB = 100;
const DEFAULT_ARCHIVE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 180 * 1000;
const DEFAULT_ANALYSIS_MAX_BUDGET_USD = 1;

/** 正の有限数なら採用、それ以外はデフォルト */
const positiveOr = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 毎回 process.env を読む（テストで環境変数を差し替え可能にするためキャッシュしない） */
export function getConfig(): DashboardConfig {
  const idleRaw = Number(process.env.IDLE_THRESHOLD_MS);
  const maxMbRaw = Number(process.env.MAX_FILE_SIZE_MB);
  const syncIntervalRaw = Number(process.env.ARCHIVE_SYNC_INTERVAL_MS);
  return {
    dataDir:
      process.env.CLAUDE_DATA_DIR ??
      path.join(os.homedir(), ".claude", "projects"),
    archiveDir:
      process.env.CLAUDE_ARCHIVE_DIR ??
      path.join(os.homedir(), ".claude-dashboard", "archive"),
    settingsPath:
      process.env.CLAUDE_SETTINGS_PATH ??
      path.join(os.homedir(), ".claude-dashboard", "settings.json"),
    archiveSyncIntervalMs:
      Number.isFinite(syncIntervalRaw) && syncIntervalRaw > 0
        ? syncIntervalRaw
        : DEFAULT_ARCHIVE_SYNC_INTERVAL_MS,
    analysisDir:
      process.env.CLAUDE_ANALYSIS_DIR ??
      path.join(os.homedir(), ".claude-dashboard", "analysis"),
    claudeCliPath: process.env.CLAUDE_CLI_PATH ?? "claude",
    codexDataDir:
      process.env.CODEX_DATA_DIR ??
      path.join(os.homedir(), ".codex", "sessions"),
    codexArchivedDir:
      process.env.CODEX_ARCHIVED_DIR ??
      path.join(os.homedir(), ".codex", "archived_sessions"),
    geminiDataDir:
      process.env.GEMINI_DATA_DIR ?? path.join(os.homedir(), ".gemini", "tmp"),
    analysisTimeoutMs: positiveOr(
      process.env.ANALYSIS_TIMEOUT_MS,
      DEFAULT_ANALYSIS_TIMEOUT_MS,
    ),
    analysisMaxBudgetUsd: positiveOr(
      process.env.ANALYSIS_MAX_BUDGET_USD,
      DEFAULT_ANALYSIS_MAX_BUDGET_USD,
    ),
    transcriptMaxChars: 40_000,
    transcriptMaxCharsPerMessage: 2_000,
    idleThresholdMs:
      Number.isFinite(idleRaw) && idleRaw > 0
        ? idleRaw
        : DEFAULT_IDLE_THRESHOLD_MS,
    maxFileSizeBytes:
      (Number.isFinite(maxMbRaw) && maxMbRaw > 0
        ? maxMbRaw
        : DEFAULT_MAX_FILE_SIZE_MB) *
      1024 *
      1024,
    weekStartsOn: 1,
    userTextMaxLength: 200,
    titleMaxLength: 60,
  };
}
