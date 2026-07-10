import { runArchiveSync } from "@/lib/archive/sync";
import { getConfig } from "@/lib/config";

declare global {
  // Next.js dev の HMR でモジュールが再評価されても interval を多重起動しない
  var __claudeDashboardArchiveTimer: NodeJS.Timeout | undefined;
}

/** 起動時に1回同期し、以後一定間隔で同期し続ける。設定は毎サイクル読み直される */
export function startArchiveScheduler(): void {
  if (globalThis.__claudeDashboardArchiveTimer !== undefined) return;

  const tick = () => {
    void runArchiveSync().catch((e) => {
      console.error("archive sync failed:", e);
    });
  };

  tick();
  const timer = setInterval(tick, getConfig().archiveSyncIntervalMs);
  timer.unref(); // interval がプロセス終了を妨げないようにする
  globalThis.__claudeDashboardArchiveTimer = timer;
}
