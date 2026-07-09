const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Host ヘッダの「ホスト名部（:ポート除去後）」を抽出する。IPv6 は [::1] 形式 */
const HOST_RE = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/;

/**
 * Host ヘッダがループバック由来かを判定する（DNSリバインディング対策）。
 * 悪意あるサイトが自ドメインを 127.0.0.1 に再解決させても、
 * ブラウザが送る Host は攻撃者ドメインのままなのでここで遮断できる。
 */
export function isAllowedHost(host: string | null): boolean {
  if (host === null) return false;
  const m = HOST_RE.exec(host.trim().toLowerCase());
  if (m === null) return false;
  return ALLOWED_HOSTNAMES.has(m[1]);
}
