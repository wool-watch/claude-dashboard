import { isSessionSourceId, type SessionSourceId } from "@/lib/sources/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
/** パス区切り等を含まない安全な id のみ許可（分析ファイル名にも使うため） */
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

export interface ParsedSessionKey {
  source: SessionSourceId;
  sessionId: string;
}

const isSafeId = (id: string): boolean =>
  SAFE_ID_RE.test(id) && !id.includes("..");

/**
 * ソース横断で一意なセッションキーを生成する。
 * claude は素の sessionId（既存URL・分析ファイル名との後方互換）、
 * それ以外は "<source>:<id>"。
 */
export function formatSessionKey(
  source: SessionSourceId,
  sessionId: string,
): string {
  return source === "claude" ? sessionId : `${source}:${sessionId}`;
}

export function parseSessionKey(key: string): ParsedSessionKey | null {
  const sep = key.indexOf(":");
  if (sep === -1) {
    return UUID_RE.test(key) ? { source: "claude", sessionId: key } : null;
  }
  const source = key.slice(0, sep);
  const sessionId = key.slice(sep + 1);
  // claude の正規形は素のIDのみ（"claude:<id>" は受け付けず一意性を保つ）
  if (source === "claude" || !isSessionSourceId(source)) return null;
  if (sessionId === "" || !isSafeId(sessionId)) return null;
  return { source, sessionId };
}

/**
 * sessionKey をファイル名 stem へ変換する（":" は Windows/Finder で不可のため "--"）。
 * 例: "codex:<id>" → "codex--<id>"、claude は素のUUIDのまま。
 */
export function sessionKeyToFileStem(key: string): string | null {
  const parsed = parseSessionKey(key);
  if (parsed === null) return null;
  return parsed.source === "claude"
    ? parsed.sessionId
    : `${parsed.source}--${parsed.sessionId}`;
}

/**
 * cwd を Claude Code と同じ規則で projectId へ変換する（記号を "-" に置換）。
 * 同一リポジトリを複数CLIで使った場合に /projects で1行に集約するため。
 */
export function encodeProjectId(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function fileStemToSessionKey(stem: string): string | null {
  if (UUID_RE.test(stem)) return stem;
  const sep = stem.indexOf("--");
  if (sep === -1) return null;
  const source = stem.slice(0, sep);
  const sessionId = stem.slice(sep + 2);
  if (source === "claude" || !isSessionSourceId(source)) return null;
  if (sessionId === "" || !isSafeId(sessionId)) return null;
  return formatSessionKey(source, sessionId);
}
