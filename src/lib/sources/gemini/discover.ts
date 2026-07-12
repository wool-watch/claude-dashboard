import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DashboardConfig } from "@/lib/config";

export interface GeminiSessionFile {
  filePath: string;
  /** ~/.gemini/tmp/<hash> のハッシュ（cwd 不明時の projectId フォールバック） */
  projectHash: string;
  /** geminiDataDir からの相対パス */
  relPath: string;
}

/** メインセッションのみ対象（サブエージェント <uuid>.jsonl や checkpoint は除外） */
export const GEMINI_SESSION_FILE_RE = /^session-.*\.jsonl$/i;

async function scanRoot(root: string, out: GeminiSessionFile[]): Promise<void> {
  let hashes: Dirent[];
  try {
    hashes = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return; // ディレクトリ未作成（Gemini 未使用等）
  }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    const chatsDir = path.join(root, h.name, "chats");
    let files: string[];
    try {
      files = await fs.readdir(chatsDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!GEMINI_SESSION_FILE_RE.test(f)) continue;
      const filePath = path.join(chatsDir, f);
      out.push({
        filePath,
        projectHash: h.name,
        relPath: path.relative(root, filePath),
      });
    }
  }
}

/**
 * Gemini CLI のチャット記録（<root>/<projectHash>/chats/session-*.jsonl）を走査する。
 * ライブ → ダッシュボードアーカイブ（archiveDir/gemini）の順で返す
 * （呼び出し側が先勝ちデデュープ）。
 */
export async function discoverGeminiSessions(
  config: DashboardConfig,
): Promise<GeminiSessionFile[]> {
  const out: GeminiSessionFile[] = [];
  await scanRoot(config.geminiDataDir, out);
  await scanRoot(path.join(config.archiveDir, "gemini"), out);
  return out;
}
