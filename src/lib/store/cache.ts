import type { SessionDetail } from "@/lib/types";

interface CacheEntry {
  mtimeMs: number;
  sizeBytes: number;
  session: SessionDetail;
}

export interface SessionCache {
  /** stat（mtime+size）が一致すればキャッシュ、変化していれば parse() を実行して格納 */
  getOrParse(
    filePath: string,
    stat: { mtimeMs: number; size: number },
    parse: () => SessionDetail,
  ): SessionDetail;
  /** 現存ファイルパス集合に含まれないエントリを削除する */
  prune(livingPaths: Set<string>): void;
  clear(): void;
}

export function createSessionCache(): SessionCache {
  const entries = new Map<string, CacheEntry>();
  return {
    getOrParse(filePath, stat, parse) {
      const entry = entries.get(filePath);
      if (
        entry !== undefined &&
        entry.mtimeMs === stat.mtimeMs &&
        entry.sizeBytes === stat.size
      ) {
        return entry.session;
      }
      const session = parse();
      entries.set(filePath, {
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        session,
      });
      return session;
    },
    prune(livingPaths) {
      for (const key of entries.keys()) {
        if (!livingPaths.has(key)) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
  };
}

declare global {
  // Next.js dev の HMR でモジュールが再評価されてもキャッシュを維持する
  // eslint-disable-next-line no-var
  var __claudeDashboardCache: SessionCache | undefined;
}

export function getGlobalCache(): SessionCache {
  globalThis.__claudeDashboardCache ??= createSessionCache();
  return globalThis.__claudeDashboardCache;
}
