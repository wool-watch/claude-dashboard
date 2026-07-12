import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";
import { readSettings } from "@/lib/settings/settings";
import { codexSessionIdFromFileName } from "@/lib/sources/codex/discover";
import { GEMINI_SESSION_FILE_RE } from "@/lib/sources/gemini/discover";
import { fileStemToSessionKey, parseSessionKey, sanitizeSessionId } from "@/lib/sources/keys";
import type { SessionSourceId } from "@/lib/sources/types";
import { SESSION_FILE_RE } from "@/lib/store/repository";

export interface SyncResult {
  copied: number;
  pruned: number;
  /** セッションが消滅したため削除した分析結果の数 */
  prunedAnalyses: number;
  errors: number;
}

/** 分析ファイル名: <uuid>.json（claude）または <source>--<id>.json */
const ANALYSIS_FILE_RE =
  /^(?:[0-9a-f-]{36}|(?:codex|gemini)--[A-Za-z0-9._-]+)\.json$/i;

const DAY_MS = 24 * 60 * 60 * 1000;

/** utimes はサブms精度を保存できないため、2ms 未満の差は同一時刻とみなす */
const sameMtime = (a: number, b: number) => Math.abs(a - b) < 2;

async function listProjectDirs(rootDir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(rootDir, { withFileTypes: true });
    return dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return []; // ルート未作成
  }
}

/** root 以下の全ファイルの relPath を再帰列挙する（root 未作成は空） */
async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full);
      else out.push(path.relative(root, full));
    }
  };
  await walk(root);
  return out;
}

/** ライブ→アーカイブへ1ファイルをミラー（無変更ならスキップ）。コピーしたら true */
async function mirrorFile(livePath: string, archPath: string): Promise<boolean> {
  const liveSt = await fs.stat(livePath);
  const archSt = await fs.stat(archPath).catch(() => null);
  if (
    archSt !== null &&
    archSt.size === liveSt.size &&
    sameMtime(archSt.mtimeMs, liveSt.mtimeMs)
  ) {
    return false;
  }
  await fs.mkdir(path.dirname(archPath), { recursive: true });
  const tmpPath = `${archPath}.${randomUUID()}.tmp`;
  await fs.copyFile(livePath, tmpPath);
  await fs.rename(tmpPath, archPath);
  await fs.utimes(archPath, liveSt.atimeMs / 1000, liveSt.mtimeMs / 1000);
  return true;
}

/** 空になったディレクトリを root まで遡って削除（中身があれば ENOTEMPTY で止まる） */
async function pruneEmptyDirs(root: string, startDir: string): Promise<void> {
  let dir = startDir;
  while (dir !== root && dir.startsWith(root)) {
    try {
      await fs.rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

interface SourceObservation {
  /** ライブ・アーカイブいずれかでセッションを1件でも観測できたか（全滅ガード） */
  observed: boolean;
  /** 生存セッション id 集合（分析の孤児判定用） */
  livingIds: Set<string>;
  /** id を特定できないファイルがあった（安全側: このソースの分析は消さない） */
  idsIncomplete: boolean;
}

const newObservation = (): SourceObservation => ({
  observed: false,
  livingIds: new Set(),
  idsIncomplete: false,
});

/** Gemini チャットファイルからメタデータの sessionId を取り出す（best-effort） */
async function geminiSessionIdOf(filePath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const nl = content.indexOf("\n");
  const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim();
  for (const candidate of [firstLine, content.trim()]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { sessionId?: unknown }).sessionId === "string"
      ) {
        return sanitizeSessionId((parsed as { sessionId: string }).sessionId);
      }
      return null;
    } catch {
      // 次の候補（ファイル全体）を試す
    }
  }
  return null;
}

/**
 * codex / gemini の1ソース分: ソース元 → archiveDir/<source>/<relPath> への
 * ミラーと、保持期間切れ（ソース元に無いもの）の削除を行う。
 */
async function syncSourceTree(
  source: "codex" | "gemini",
  originRoots: string[],
  isSessionFile: (fileName: string) => boolean,
  archiveRoot: string,
  cutoffMs: number | null,
  result: SyncResult,
): Promise<{ originRelPaths: Set<string> }> {
  const originRelPaths = new Set<string>();
  for (const root of originRoots) {
    for (const relPath of await listFilesRecursive(root)) {
      if (!isSessionFile(path.basename(relPath))) continue;
      originRelPaths.add(relPath);
      try {
        if (await mirrorFile(path.join(root, relPath), path.join(archiveRoot, relPath))) {
          result.copied += 1;
        }
      } catch (e) {
        result.errors += 1;
        console.error(`archive sync failed for ${source}/${relPath}:`, e);
      }
    }
  }

  for (const relPath of await listFilesRecursive(archiveRoot)) {
    const filePath = path.join(archiveRoot, relPath);
    try {
      if (relPath.endsWith(".tmp")) {
        await fs.unlink(filePath);
        continue;
      }
      if (!isSessionFile(path.basename(relPath))) continue;
      if (cutoffMs === null) continue;
      if (originRelPaths.has(relPath)) continue; // ソース元に在る間は消さない
      const st = await fs.stat(filePath);
      if (st.mtimeMs < cutoffMs) {
        await fs.unlink(filePath);
        result.pruned += 1;
        await pruneEmptyDirs(archiveRoot, path.dirname(filePath));
      }
    } catch (e) {
      result.errors += 1;
      console.error(`archive prune failed for ${source}/${relPath}:`, e);
    }
  }

  return { originRelPaths };
}

/** ライブ→アーカイブへの新規/更新コピーと、保持期間切れアーカイブの削除を1パスずつ行う */
export async function syncArchive(
  config: DashboardConfig,
  settings: AppSettings,
  now: Date = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = { copied: 0, pruned: 0, prunedAnalyses: 0, errors: 0 };
  await fs.mkdir(config.archiveDir, { recursive: true });

  const cutoffMs =
    settings.retentionDays === null
      ? null
      : now.getTime() - settings.retentionDays * DAY_MS;

  const observations: Record<SessionSourceId, SourceObservation> = {
    claude: newObservation(),
    codex: newObservation(),
    gemini: newObservation(),
  };

  // ---- claude: コピーフェーズ（従来レイアウト <projectId>/<uuid>.jsonl） ----
  const livePaths = new Set<string>(); // "{projectId}/{file}"
  for (const projectId of await listProjectDirs(config.dataDir)) {
    const liveProjectDir = path.join(config.dataDir, projectId);
    let files: string[];
    try {
      files = await fs.readdir(liveProjectDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!SESSION_FILE_RE.test(file)) continue;
      livePaths.add(`${projectId}/${file}`);
      try {
        if (
          await mirrorFile(
            path.join(liveProjectDir, file),
            path.join(config.archiveDir, projectId, file),
          )
        ) {
          result.copied += 1;
        }
      } catch (e) {
        result.errors += 1;
        console.error(`archive sync failed for ${projectId}/${file}:`, e);
      }
    }
  }

  // ---- claude: プルーニングフェーズ ----
  // 注: codex/gemini のアーカイブは archiveDir 直下の "codex"/"gemini" に置くが、
  // claude の projectId は必ず "-" 始まりのため listProjectDirs の対象になっても
  // SESSION_FILE_RE に合致するファイルを含まず、ここでは実質スキップされる
  for (const projectId of await listProjectDirs(config.archiveDir)) {
    if (projectId === "codex" || projectId === "gemini") continue;
    const archProjectDir = path.join(config.archiveDir, projectId);
    let files: string[];
    try {
      files = await fs.readdir(archProjectDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(archProjectDir, file);
      try {
        if (file.endsWith(".tmp")) {
          await fs.unlink(filePath);
          continue;
        }
        if (!SESSION_FILE_RE.test(file)) continue;
        observations.claude.observed = true;
        observations.claude.livingIds.add(file.replace(/\.jsonl$/i, ""));
        if (cutoffMs === null) continue;
        if (livePaths.has(`${projectId}/${file}`)) continue; // ライブに在る間は消さない
        const st = await fs.stat(filePath);
        if (st.mtimeMs < cutoffMs) {
          await fs.unlink(filePath);
          observations.claude.livingIds.delete(file.replace(/\.jsonl$/i, ""));
          result.pruned += 1;
        }
      } catch (e) {
        result.errors += 1;
        console.error(`archive prune failed for ${projectId}/${file}:`, e);
      }
    }
    // 空になったプロジェクトディレクトリは削除（中身があれば ENOTEMPTY で失敗し、無視）
    await fs.rmdir(archProjectDir).catch(() => {});
  }
  for (const key of livePaths) {
    observations.claude.observed = true;
    observations.claude.livingIds.add(key.split("/")[1].replace(/\.jsonl$/i, ""));
  }

  // ---- codex / gemini: ミラーと保持期間 ----
  const codexArchiveRoot = path.join(config.archiveDir, "codex");
  const codexSync = await syncSourceTree(
    "codex",
    [config.codexDataDir, config.codexArchivedDir],
    (name) => codexSessionIdFromFileName(name) !== null,
    codexArchiveRoot,
    cutoffMs,
    result,
  );
  const geminiArchiveRoot = path.join(config.archiveDir, "gemini");
  const geminiSync = await syncSourceTree(
    "gemini",
    [config.geminiDataDir],
    (name) => GEMINI_SESSION_FILE_RE.test(name),
    geminiArchiveRoot,
    cutoffMs,
    result,
  );

  // codex: セッション id はファイル名から確定できる
  for (const relPath of codexSync.originRelPaths) {
    const id = codexSessionIdFromFileName(path.basename(relPath));
    if (id !== null) observations.codex.livingIds.add(id);
  }
  for (const relPath of await listFilesRecursive(codexArchiveRoot)) {
    const id = codexSessionIdFromFileName(path.basename(relPath));
    if (id !== null) observations.codex.livingIds.add(id);
  }
  observations.codex.observed = observations.codex.livingIds.size > 0;

  // gemini: セッション id はファイル内メタデータから読む（読めないものは安全側に倒す）
  const geminiFiles = new Set<string>();
  for (const relPath of geminiSync.originRelPaths) {
    geminiFiles.add(path.join(config.geminiDataDir, relPath));
  }
  for (const relPath of await listFilesRecursive(geminiArchiveRoot)) {
    if (GEMINI_SESSION_FILE_RE.test(path.basename(relPath))) {
      geminiFiles.add(path.join(geminiArchiveRoot, relPath));
    }
  }
  for (const filePath of geminiFiles) {
    observations.gemini.observed = true;
    const id = await geminiSessionIdOf(filePath);
    if (id === null) observations.gemini.idsIncomplete = true;
    else observations.gemini.livingIds.add(id);
  }

  // ---- 孤児分析クリーンアップ（ソース別全滅ガード） ----
  // 全滅ガード: そのソースのセッションを1件も観測できなかったときは、そのソースの
  // 分析を削除しない。一時的な読み取り失敗や誤設定（ディレクトリ差し替え漏れ等）で
  // 全分析を失わないための防御。あるソースの不調が他ソースの掃除を止めることはない
  let analysisFiles: string[];
  try {
    analysisFiles = await fs.readdir(config.analysisDir);
  } catch {
    analysisFiles = []; // 分析未実施
  }
  for (const file of analysisFiles) {
    if (!ANALYSIS_FILE_RE.test(file)) continue;
    const sessionKey = fileStemToSessionKey(file.replace(/\.json$/i, ""));
    if (sessionKey === null) continue;
    const parsed = parseSessionKey(sessionKey);
    if (parsed === null) continue;
    const obs = observations[parsed.source];
    if (!obs.observed || obs.idsIncomplete) continue;
    if (obs.livingIds.has(parsed.sessionId)) continue;
    try {
      await fs.unlink(path.join(config.analysisDir, file));
      result.prunedAnalyses += 1;
    } catch (e) {
      result.errors += 1;
      console.error(`analysis prune failed for ${file}:`, e);
    }
  }

  return result;
}

// 同時に呼ばれても同期は1回に共有する（repository.ts の in-flight と同パターン）
let inflight: Promise<SyncResult> | null = null;

export function runArchiveSync(): Promise<SyncResult> {
  if (inflight !== null) return inflight;
  inflight = (async () => {
    const config = getConfig();
    const settings = await readSettings(config.settingsPath);
    return syncArchive(config, settings);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
