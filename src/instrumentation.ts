export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startArchiveScheduler } = await import("@/lib/archive/scheduler");
  startArchiveScheduler();
}
