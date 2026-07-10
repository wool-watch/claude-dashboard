export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startArchiveScheduler } = await import("@/lib/archive/scheduler");
  startArchiveScheduler();
  const { normalizeQueueOnBoot } = await import("@/lib/analysis/queue");
  void normalizeQueueOnBoot().catch((e) => {
    console.error("queue normalize failed:", e);
  });
}
