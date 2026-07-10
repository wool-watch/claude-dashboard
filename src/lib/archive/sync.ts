import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";
import { readSettings } from "@/lib/settings/settings";
import { SESSION_FILE_RE } from "@/lib/store/repository";

export interface SyncResult {
  copied: number;
  pruned: number;
  errors: number;
}

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

/** ライブ→アーカイブへの新規/更新コピーと、保持期間切れアーカイブの削除を1パスずつ行う */
export async function syncArchive(
  config: DashboardConfig,
  settings: AppSettings,
  now: Date = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = { copied: 0, pruned: 0, errors: 0 };
  await fs.mkdir(config.archiveDir, { recursive: true });

  // コピーフェーズ: ライブ側を列挙し、無い/変わったファイルをミラーする
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
        const livePath = path.join(liveProjectDir, file);
        const archPath = path.join(config.archiveDir, projectId, file);
        const liveSt = await fs.stat(livePath);
        const archSt = await fs.stat(archPath).catch(() => null);
        if (
          archSt !== null &&
          archSt.size === liveSt.size &&
          sameMtime(archSt.mtimeMs, liveSt.mtimeMs)
        ) {
          continue;
        }
        await fs.mkdir(path.dirname(archPath), { recursive: true });
        const tmpPath = `${archPath}.${randomUUID()}.tmp`;
        await fs.copyFile(livePath, tmpPath);
        await fs.rename(tmpPath, archPath);
        await fs.utimes(archPath, liveSt.atimeMs / 1000, liveSt.mtimeMs / 1000);
        result.copied += 1;
      } catch (e) {
        result.errors += 1;
        console.error(`archive sync failed for ${projectId}/${file}:`, e);
      }
    }
  }

  // クリーンアップ/プルーニングフェーズ: 残留 .tmp と保持期間切れ（ライブに無いもの）を削除
  const cutoffMs =
    settings.retentionDays === null
      ? null
      : now.getTime() - settings.retentionDays * DAY_MS;
  for (const projectId of await listProjectDirs(config.archiveDir)) {
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
        if (cutoffMs === null) continue;
        if (livePaths.has(`${projectId}/${file}`)) continue; // ライブに在る間は消さない
        const st = await fs.stat(filePath);
        if (st.mtimeMs < cutoffMs) {
          await fs.unlink(filePath);
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
