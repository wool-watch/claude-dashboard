/**
 * ギャップベースの操作時間推定。
 * 昇順ソート後、隣接間隔が idleThresholdMs 以内（境界含む）なら加算、
 * 超えたら離席とみなして不算入。
 */
export function estimateActiveTime(
  timestamps: Date[],
  idleThresholdMs: number,
): number {
  const times = timestamps
    .map((t) => t.getTime())
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);

  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap <= idleThresholdMs) total += gap;
  }
  return total;
}
