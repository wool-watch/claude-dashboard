import os from "node:os";
import path from "node:path";

export interface DashboardConfig {
  dataDir: string;
  archiveDir: string;
  settingsPath: string;
  archiveSyncIntervalMs: number;
  idleThresholdMs: number;
  maxFileSizeBytes: number;
  weekStartsOn: 1;
  userTextMaxLength: number;
  titleMaxLength: number;
}

const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FILE_SIZE_MB = 100;
const DEFAULT_ARCHIVE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
