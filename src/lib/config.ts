import os from "node:os";
import path from "node:path";

export interface DashboardConfig {
  dataDir: string;
  idleThresholdMs: number;
  maxFileSizeBytes: number;
  weekStartsOn: 1;
  userTextMaxLength: number;
  titleMaxLength: number;
}

const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FILE_SIZE_MB = 100;

/** 毎回 process.env を読む（テストで環境変数を差し替え可能にするためキャッシュしない） */
export function getConfig(): DashboardConfig {
  const idleRaw = Number(process.env.IDLE_THRESHOLD_MS);
  const maxMbRaw = Number(process.env.MAX_FILE_SIZE_MB);
  return {
    dataDir:
      process.env.CLAUDE_DATA_DIR ??
      path.join(os.homedir(), ".claude", "projects"),
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
