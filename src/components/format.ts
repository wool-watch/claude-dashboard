/** トークン数の短縮表記: 999 / 12.3k / 1.2M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  // 999,950 以上は k だと "1000.0k" になるため M に切替える
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** USD 表記: $1未満は4桁、$1以上は2桁 */
export function formatUSD(n: number): string {
  if (n > 0 && n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** 時間の日本語表記: 45秒 / 12分 / 1時間23分 / 2日4時間 */
export function formatDurationJa(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0
      ? `${totalHours}時間`
      : `${totalHours}時間${minutes}分`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}日` : `${days}日${hours}時間`;
}

/** ローカルTZの "M/d HH:mm"。不正値は入力をそのまま返す */
export function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
