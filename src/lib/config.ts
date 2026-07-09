import os from "node:os";
import path from "node:path";

export interface DashboardConfig {
  dataDir: string;
  idleThresholdMs: number;
  weekStartsOn: 1;
  userTextMaxLength: number;
  titleMaxLength: number;
}

const DEFAULT_IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/** 毎回 process.env を読む（テストで環境変数を差し替え可能にするためキャッシュしない） */
export function getConfig(): DashboardConfig {
  const idleRaw = Number(process.env.IDLE_THRESHOLD_MS);
  return {
    dataDir:
      process.env.CLAUDE_DATA_DIR ??
      path.join(os.homedir(), ".claude", "projects"),
    idleThresholdMs:
      Number.isFinite(idleRaw) && idleRaw > 0
        ? idleRaw
        : DEFAULT_IDLE_THRESHOLD_MS,
    weekStartsOn: 1,
    userTextMaxLength: 200,
    titleMaxLength: 60,
  };
}
