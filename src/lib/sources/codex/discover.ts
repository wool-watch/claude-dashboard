import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DashboardConfig } from "@/lib/config";

export interface CodexSessionFile {
  filePath: string;
  /** ファイル名末尾の UUID */
  sessionId: string;
  /** ルート（sessions/ or archived_sessions/）からの相対パス */
  relPath: string;
  fromArchive: boolean;
}

export const ROLLOUT_FILE_RE =
  /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** rollout ファイル名から sessionId（末尾UUID）を取り出す */
export function codexSessionIdFromFileName(fileName: string): string | null {
  const m = ROLLOUT_FILE_RE.exec(fileName);
  return m === null ? null : m[1].toLowerCase();
}

async function walk(
  root: string,
  dir: string,
  fromArchive: boolean,
  out: CodexSessionFile[],
): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // ディレクトリ未作成（Codex 未使用等）
  }
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      await walk(root, full, fromArchive, out);
      continue;
    }
    const m = ROLLOUT_FILE_RE.exec(d.name);
    if (m === null) continue;
    out.push({
      filePath: full,
      sessionId: m[1].toLowerCase(),
      relPath: path.relative(root, full),
      fromArchive,
    });
  }
}

/**
 * Codex の日付ツリー（YYYY/MM/DD/rollout-*.jsonl）を走査する。
 * ライブ → archived_sessions → ダッシュボードアーカイブ（archiveDir/codex）の順で
 * 返す（呼び出し側が先勝ちデデュープ）。
 */
export async function discoverCodexSessions(
  config: DashboardConfig,
): Promise<CodexSessionFile[]> {
  const out: CodexSessionFile[] = [];
  await walk(config.codexDataDir, config.codexDataDir, false, out);
  await walk(config.codexArchivedDir, config.codexArchivedDir, true, out);
  const dashboardArchive = path.join(config.archiveDir, "codex");
  await walk(dashboardArchive, dashboardArchive, true, out);
  return out;
}
