import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { buildSession } from "@/lib/domain/session-builder";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import { getGlobalCache } from "@/lib/store/cache";
import type { SessionDetail } from "@/lib/types";

export const SESSION_FILE_RE = /^[0-9a-f-]{36}\.jsonl$/i;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// 同一レンダリング内の複数APIから叩かれても走査は1回に共有する
let inflight: Promise<SessionDetail[]> | null = null;

export async function getAllSessions(): Promise<SessionDetail[]> {
  if (inflight !== null) return inflight;
  inflight = scan().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getSession(
  sessionId: string,
): Promise<SessionDetail | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const sessions = await getAllSessions();
  return sessions.find((s) => s.sessionId === sessionId) ?? null;
}

async function scan(): Promise<SessionDetail[]> {
  const config = getConfig();
  const cache = getGlobalCache();

  const sessions: SessionDetail[] = [];
  const livingPaths = new Set<string>();
  const seenSessionIds = new Set<string>();

  // ライブを先に走査し、アーカイブは未出の sessionId のみ採用する（ライブ優先）
  await scanRoot(config.dataDir, config, cache, sessions, livingPaths, seenSessionIds);
  await scanRoot(config.archiveDir, config, cache, sessions, livingPaths, seenSessionIds);

  cache.prune(livingPaths);
  return sessions.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

async function scanRoot(
  rootDir: string,
  config: ReturnType<typeof getConfig>,
  cache: ReturnType<typeof getGlobalCache>,
  sessions: SessionDetail[],
  livingPaths: Set<string>,
  seenSessionIds: Set<string>,
): Promise<void> {
  let projectIds: string[];
  try {
    const dirents = await fs.readdir(rootDir, { withFileTypes: true });
    projectIds = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return; // ディレクトリ未作成（初回起動等）
  }

  for (const projectId of projectIds) {
    const dirPath = path.join(rootDir, projectId);
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!SESSION_FILE_RE.test(file)) continue;
      const sessionId = file.replace(/\.jsonl$/i, "");
      if (seenSessionIds.has(sessionId)) continue;
      const filePath = path.join(dirPath, file);
      let st: { mtimeMs: number; size: number };
      try {
        st = await fs.stat(filePath);
      } catch {
        continue; // 走査中に消えたファイル
      }
      if (st.size > config.maxFileSizeBytes) {
        console.warn(
          `skipping oversized session file (${st.size} bytes > ${config.maxFileSizeBytes}): ${filePath}`,
        );
        continue;
      }
      livingPaths.add(filePath);
      seenSessionIds.add(sessionId);
      const session = cache.getOrParse(filePath, st, () => {
        const { records, skippedLines } = parseJsonlLines(
          readFileSync(filePath, "utf8"),
        );
        return buildSession(records, sessionId, projectId, skippedLines, config);
      });
      sessions.push(session);
    }
  }
}
