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
const SESSION_FILE_RE = /^session-.*\.jsonl$/i;

/**
 * Gemini CLI のチャット記録（<geminiDataDir>/<projectHash>/chats/session-*.jsonl）を走査する。
 */
export async function discoverGeminiSessions(
  config: DashboardConfig,
): Promise<GeminiSessionFile[]> {
  const out: GeminiSessionFile[] = [];
  let hashes: Dirent[];
  try {
    hashes = await fs.readdir(config.geminiDataDir, { withFileTypes: true });
  } catch {
    return out; // ディレクトリ未作成（Gemini 未使用等）
  }
  for (const h of hashes) {
    if (!h.isDirectory()) continue;
    const chatsDir = path.join(config.geminiDataDir, h.name, "chats");
    let files: string[];
    try {
      files = await fs.readdir(chatsDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!SESSION_FILE_RE.test(f)) continue;
      const filePath = path.join(chatsDir, f);
      out.push({
        filePath,
        projectHash: h.name,
        relPath: path.relative(config.geminiDataDir, filePath),
      });
    }
  }
  return out;
}
