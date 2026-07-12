import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { buildSession } from "@/lib/domain/session-builder";
import { parseJsonlLines } from "@/lib/parser/jsonl";
import { discoverCodexSessions } from "@/lib/sources/codex/discover";
import { parseCodexRollout } from "@/lib/sources/codex/parser";
import { discoverGeminiSessions } from "@/lib/sources/gemini/discover";
import { parseGeminiChat } from "@/lib/sources/gemini/parser";
import {
  encodeProjectId,
  formatSessionKey,
  parseSessionKey,
  sanitizeSessionId,
} from "@/lib/sources/keys";
import type { SessionSourceId } from "@/lib/sources/types";
import { getGlobalCache } from "@/lib/store/cache";
import type { SessionDetail } from "@/lib/types";

export const SESSION_FILE_RE = /^[0-9a-f-]{36}\.jsonl$/i;

// 同一レンダリング内の複数APIから叩かれても走査は1回に共有する
let inflight: Promise<SessionDetail[]> | null = null;

/**
 * sessionKey → ファイル位置のインデックス（scan 時に構築）。
 * Codex の日付ツリー等はパス直撃で解決できないため、これを介して引く。
 */
let sessionIndex = new Map<
  string,
  { filePath: string; projectId: string; source: SessionSourceId }
>();

export async function getAllSessions(): Promise<SessionDetail[]> {
  if (inflight !== null) return inflight;
  inflight = scan().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getSession(
  sessionKey: string,
): Promise<SessionDetail | null> {
  if (parseSessionKey(sessionKey) === null) return null;
  const sessions = await getAllSessions();
  return sessions.find((s) => s.sessionKey === sessionKey) ?? null;
}

export interface SessionFileRef {
  filePath: string;
  projectId: string;
  mtimeMs: number;
  size: number;
  source: SessionSourceId;
}

/**
 * sessionKey から生ファイルのパスと stat を解決する。
 * claude はライブ優先→アーカイブの readdir + stat 直撃（走査不要で軽い）、
 * それ以外のソースは scan 由来のインデックスを引く。
 */
export async function getSessionFileRef(
  sessionKey: string,
): Promise<SessionFileRef | null> {
  const parsed = parseSessionKey(sessionKey);
  if (parsed === null) return null;
  const config = getConfig();

  if (parsed.source === "claude") {
    for (const rootDir of [config.dataDir, config.archiveDir]) {
      let projectIds: string[];
      try {
        const dirents = await fs.readdir(rootDir, { withFileTypes: true });
        projectIds = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        continue;
      }
      for (const projectId of projectIds) {
        const filePath = path.join(rootDir, projectId, `${parsed.sessionId}.jsonl`);
        try {
          const st = await fs.stat(filePath);
          return {
            filePath,
            projectId,
            mtimeMs: st.mtimeMs,
            size: st.size,
            source: "claude",
          };
        } catch {
          // このプロジェクトには無い
        }
      }
    }
    return null;
  }

  // インデックス未載 or ファイル消失（アーカイブ移動等）なら再走査して1回だけ引き直す
  let ref = await statIndexEntry(sessionKey);
  if (ref === null) {
    await getAllSessions();
    ref = await statIndexEntry(sessionKey);
  }
  return ref;
}

async function statIndexEntry(
  sessionKey: string,
): Promise<SessionFileRef | null> {
  const entry = sessionIndex.get(sessionKey);
  if (entry === undefined) return null;
  try {
    const st = await fs.stat(entry.filePath);
    return { ...entry, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

async function scan(): Promise<SessionDetail[]> {
  const config = getConfig();
  const cache = getGlobalCache();

  const sessions: SessionDetail[] = [];
  const livingPaths = new Set<string>();
  const seenSessionKeys = new Set<string>();
  const index: typeof sessionIndex = new Map();

  // ライブを先に走査し、アーカイブは未出の sessionId のみ採用する（ライブ優先）
  await scanClaudeRoot(config.dataDir, config, cache, sessions, livingPaths, seenSessionKeys, index);
  await scanClaudeRoot(config.archiveDir, config, cache, sessions, livingPaths, seenSessionKeys, index);
  await scanCodex(config, cache, sessions, livingPaths, seenSessionKeys, index);
  await scanGemini(config, cache, sessions, livingPaths, seenSessionKeys, index);

  cache.prune(livingPaths);
  sessionIndex = index;
  return sessions.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

async function scanClaudeRoot(
  rootDir: string,
  config: ReturnType<typeof getConfig>,
  cache: ReturnType<typeof getGlobalCache>,
  sessions: SessionDetail[],
  livingPaths: Set<string>,
  seenSessionKeys: Set<string>,
  index: typeof sessionIndex,
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
      const sessionKey = formatSessionKey("claude", sessionId);
      if (seenSessionKeys.has(sessionKey)) continue;
      const filePath = path.join(dirPath, file);
      const st = await statWithinLimit(filePath, config);
      if (st === null) continue;
      livingPaths.add(filePath);
      seenSessionKeys.add(sessionKey);
      const session = cache.getOrParse(filePath, st, () => {
        const { records, skippedLines } = parseJsonlLines(
          readFileSync(filePath, "utf8"),
        );
        return buildSession(records, sessionId, projectId, skippedLines, config);
      });
      sessions.push(session);
      index.set(sessionKey, { filePath, projectId, source: "claude" });
    }
  }
}

async function scanCodex(
  config: ReturnType<typeof getConfig>,
  cache: ReturnType<typeof getGlobalCache>,
  sessions: SessionDetail[],
  livingPaths: Set<string>,
  seenSessionKeys: Set<string>,
  index: typeof sessionIndex,
): Promise<void> {
  const files = await discoverCodexSessions(config);
  for (const f of files) {
    const sessionKey = formatSessionKey("codex", f.sessionId);
    if (seenSessionKeys.has(sessionKey)) continue; // ライブ優先（discover の順序に依存）
    const st = await statWithinLimit(f.filePath, config);
    if (st === null) continue;
    livingPaths.add(f.filePath);
    seenSessionKeys.add(sessionKey);
    const session = cache.getOrParse(f.filePath, st, () => {
      const { records, skippedLines, overrides } = parseCodexRollout(
        readFileSync(f.filePath, "utf8"),
      );
      const projectId =
        overrides.projectPath !== undefined
          ? encodeProjectId(overrides.projectPath)
          : "codex-unknown";
      return buildSession(records, f.sessionId, projectId, skippedLines, config, {
        source: "codex",
        overrides,
      });
    });
    sessions.push(session);
    index.set(sessionKey, {
      filePath: f.filePath,
      projectId: session.projectId,
      source: "codex",
    });
  }
}

async function scanGemini(
  config: ReturnType<typeof getConfig>,
  cache: ReturnType<typeof getGlobalCache>,
  sessions: SessionDetail[],
  livingPaths: Set<string>,
  seenSessionKeys: Set<string>,
  index: typeof sessionIndex,
): Promise<void> {
  const files = await discoverGeminiSessions(config);
  for (const f of files) {
    const st = await statWithinLimit(f.filePath, config);
    if (st === null) continue;
    // sessionId はメタデータ行由来のためパース後に確定する（キャッシュ済みなら再パース不要）
    const session = cache.getOrParse(f.filePath, st, () => {
      const { records, skippedLines, overrides, sessionId } = parseGeminiChat(
        readFileSync(f.filePath, "utf8"),
      );
      const id = sanitizeSessionId(
        sessionId ?? path.basename(f.filePath).replace(/\.jsonl$/i, ""),
      );
      const projectId =
        overrides.projectPath !== undefined
          ? encodeProjectId(overrides.projectPath)
          : `gemini-${f.projectHash}`;
      return buildSession(records, id, projectId, skippedLines, config, {
        source: "gemini",
        overrides,
      });
    });
    if (seenSessionKeys.has(session.sessionKey)) continue;
    livingPaths.add(f.filePath);
    seenSessionKeys.add(session.sessionKey);
    sessions.push(session);
    index.set(session.sessionKey, {
      filePath: f.filePath,
      projectId: session.projectId,
      source: "gemini",
    });
  }
}

/** stat し、サイズ上限超過や消失は null（呼び出し側はスキップ） */
async function statWithinLimit(
  filePath: string,
  config: ReturnType<typeof getConfig>,
): Promise<{ mtimeMs: number; size: number } | null> {
  let st: { mtimeMs: number; size: number };
  try {
    st = await fs.stat(filePath);
  } catch {
    return null; // 走査中に消えたファイル
  }
  if (st.size > config.maxFileSizeBytes) {
    console.warn(
      `skipping oversized session file (${st.size} bytes > ${config.maxFileSizeBytes}): ${filePath}`,
    );
    return null;
  }
  return st;
}
