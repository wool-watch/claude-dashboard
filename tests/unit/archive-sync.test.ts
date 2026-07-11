import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runArchiveSync, syncArchive } from "@/lib/archive/sync";
import { getConfig } from "@/lib/config";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const DAY_MS = 24 * 60 * 60 * 1000;

let liveDir: string;
let archiveDir: string;
let analysisDir: string;

beforeEach(() => {
  liveDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-live-"));
  archiveDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "claude-dash-arch-")),
    "archive",
  );
  // sync() は getConfig() 経由で analysisDir も参照するため、必ず一時側へ差し替える。
  // 差し替えを忘れると孤児クリーンアップが実データの分析結果を削除してしまう
  analysisDir = path.join(path.dirname(archiveDir), "analysis");
  process.env.CLAUDE_DATA_DIR = liveDir;
  process.env.CLAUDE_ARCHIVE_DIR = archiveDir;
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
});

afterEach(() => {
  delete process.env.CLAUDE_DATA_DIR;
  delete process.env.CLAUDE_ARCHIVE_DIR;
  delete process.env.CLAUDE_ANALYSIS_DIR;
  rmSync(liveDir, { recursive: true, force: true });
  rmSync(path.dirname(archiveDir), { recursive: true, force: true });
  vi.restoreAllMocks();
});

const writeLive = (projectId: string, uuid: string, content: string) => {
  const dir = path.join(liveDir, projectId);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${uuid}.jsonl`);
  writeFileSync(filePath, content);
  return filePath;
};

const archivePath = (projectId: string, uuid: string) =>
  path.join(archiveDir, projectId, `${uuid}.jsonl`);

const sync = (retentionDays: 30 | 90 | 120 | 150 | 180 | null = null, now?: Date) =>
  syncArchive(getConfig(), { ...DEFAULT_SETTINGS, retentionDays }, now);

describe("syncArchive: コピー", () => {
  it("ライブのセッションファイルをアーカイブへミラーし mtime を保存する", async () => {
    const livePath = writeLive("-proj-a", UUID_A, "live content\n");
    const past = new Date(Date.now() - 10 * DAY_MS);
    utimesSync(livePath, past, past);

    const result = await sync();

    expect(result.copied).toBe(1);
    expect(result.errors).toBe(0);
    const arch = archivePath("-proj-a", UUID_A);
    expect(readFileSync(arch, "utf8")).toBe("live content\n");
    // utimes はサブms精度を保存できないため ms 単位で比較する
    expect(
      Math.abs(statSync(arch).mtimeMs - statSync(livePath).mtimeMs),
    ).toBeLessThan(2);
  });

  it("変更が無ければ2回目はコピーしない", async () => {
    writeLive("-proj-a", UUID_A, "content\n");
    await sync();

    const spy = vi.spyOn(fsp, "copyFile");
    const result = await sync();

    expect(result.copied).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ライブ側の追記（mtime/size変更）で再コピーする", async () => {
    const livePath = writeLive("-proj-a", UUID_A, "v1\n");
    await sync();

    writeFileSync(livePath, "v1\nv2\n");
    const future = new Date(Date.now() + 5000);
    utimesSync(livePath, future, future);

    const result = await sync();
    expect(result.copied).toBe(1);
    expect(readFileSync(archivePath("-proj-a", UUID_A), "utf8")).toBe("v1\nv2\n");
  });

  it("非UUID名や .jsonl 以外はコピーしない", async () => {
    writeLive("-proj-a", UUID_A, "ok\n");
    writeFileSync(path.join(liveDir, "-proj-a", "notes.jsonl"), "x");
    writeFileSync(path.join(liveDir, "-proj-a", `${UUID_B}.txt`), "x");

    await sync();

    expect(readdirSync(path.join(archiveDir, "-proj-a"))).toEqual([
      `${UUID_A}.jsonl`,
    ]);
  });

  it("ライブディレクトリが無くてもエラーにならない", async () => {
    rmSync(liveDir, { recursive: true, force: true });
    const result = await sync();
    expect(result).toEqual({
      copied: 0,
      pruned: 0,
      prunedAnalyses: 0,
      errors: 0,
    });
  });

  it("ライブから削除されたファイルはアーカイブに残る", async () => {
    const livePath = writeLive("-proj-a", UUID_A, "keep me\n");
    await sync();

    rmSync(livePath);
    const result = await sync();

    expect(result.pruned).toBe(0);
    expect(existsSync(archivePath("-proj-a", UUID_A))).toBe(true);
  });

  it("ファイル単位のエラーでは同期全体を中断しない", async () => {
    writeLive("-proj-a", UUID_A, "a\n");
    writeLive("-proj-b", UUID_B, "b\n");
    const original = fsp.copyFile;
    vi.spyOn(fsp, "copyFile").mockImplementation(async (src, dest, mode?) => {
      if (String(src).includes(UUID_A)) throw new Error("boom");
      return original(src, dest, mode);
    });

    const result = await sync();

    expect(result.errors).toBe(1);
    expect(result.copied).toBe(1);
    expect(existsSync(archivePath("-proj-b", UUID_B))).toBe(true);
  });
});

describe("syncArchive: プルーニング", () => {
  const writeArchived = (projectId: string, uuid: string, ageDays: number) => {
    const dir = path.join(archiveDir, projectId);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${uuid}.jsonl`);
    writeFileSync(filePath, "archived\n");
    const t = new Date(Date.now() - ageDays * DAY_MS);
    utimesSync(filePath, t, t);
    return filePath;
  };

  it("保持期間を超えたアーカイブ（ライブに無い）を削除する", async () => {
    writeArchived("-proj-a", UUID_A, 40);
    writeArchived("-proj-a", UUID_B, 10);

    const result = await sync(30);

    expect(result.pruned).toBe(1);
    expect(existsSync(archivePath("-proj-a", UUID_A))).toBe(false);
    expect(existsSync(archivePath("-proj-a", UUID_B))).toBe(true);
  });

  it("無制限（null）では何も削除しない", async () => {
    writeArchived("-proj-a", UUID_A, 400);
    const result = await sync(null);
    expect(result.pruned).toBe(0);
    expect(existsSync(archivePath("-proj-a", UUID_A))).toBe(true);
  });

  it("ライブに存在するファイルは期限切れでも削除しない", async () => {
    const livePath = writeLive("-proj-a", UUID_A, "old but live\n");
    const past = new Date(Date.now() - 100 * DAY_MS);
    utimesSync(livePath, past, past);

    const result = await sync(30);

    expect(result.pruned).toBe(0);
    expect(existsSync(archivePath("-proj-a", UUID_A))).toBe(true);
  });

  it("now を注入して境界を制御できる", async () => {
    writeArchived("-proj-a", UUID_A, 40);
    // 10日後の now を注入すれば 40日前のファイルは 50日経過扱い
    const result = await sync(90, new Date(Date.now() + 60 * DAY_MS));
    expect(result.pruned).toBe(1);
  });

  it("空になったプロジェクトディレクトリを削除する", async () => {
    writeArchived("-proj-a", UUID_A, 40);
    await sync(30);
    expect(existsSync(path.join(archiveDir, "-proj-a"))).toBe(false);
  });

  it("残留 .tmp ファイルを掃除する", async () => {
    const dir = path.join(archiveDir, "-proj-a");
    mkdirSync(dir, { recursive: true });
    const tmpFile = path.join(dir, `${UUID_A}.jsonl.x.tmp`);
    writeFileSync(tmpFile, "partial");

    await sync();

    expect(existsSync(tmpFile)).toBe(false);
  });
});

describe("syncArchive: 分析結果の孤児クリーンアップ", () => {
  const writeAnalysisFile = (uuid: string) => {
    mkdirSync(analysisDir, { recursive: true });
    const p = path.join(analysisDir, `${uuid}.json`);
    writeFileSync(p, JSON.stringify({ sessionId: uuid }));
    return p;
  };

  it("セッションがライブ・アーカイブ双方に無ければ分析JSONを削除する", async () => {
    writeLive("-proj-a", UUID_B, "living\n"); // 生存セッションが1件でもあれば掃除は有効
    const orphan = writeAnalysisFile(UUID_A);
    const result = await sync();
    expect(result.prunedAnalyses).toBe(1);
    expect(existsSync(orphan)).toBe(false);
  });

  it("ライブ・アーカイブ双方にセッションが1件も無ければ削除をスキップする（全滅ガード）", async () => {
    const orphan = writeAnalysisFile(UUID_A);
    const result = await sync();
    expect(result.prunedAnalyses).toBe(0);
    expect(existsSync(orphan)).toBe(true);
  });

  it("ライブに存在するセッションの分析は保持する", async () => {
    writeLive("-proj-a", UUID_A, "content\n");
    const kept = writeAnalysisFile(UUID_A);
    const result = await sync();
    expect(result.prunedAnalyses).toBe(0);
    expect(existsSync(kept)).toBe(true);
  });

  it("アーカイブのみに存在するセッションの分析も保持する", async () => {
    const dir = path.join(archiveDir, "-proj-a");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${UUID_A}.jsonl`), "archived\n");
    const kept = writeAnalysisFile(UUID_A);
    const result = await sync();
    expect(result.prunedAnalyses).toBe(0);
    expect(existsSync(kept)).toBe(true);
  });

  it("保持期間切れでアーカイブから消えた同じ実行で分析も消える", async () => {
    const dir = path.join(archiveDir, "-proj-a");
    mkdirSync(dir, { recursive: true });
    const archived = path.join(dir, `${UUID_A}.jsonl`);
    writeFileSync(archived, "old\n");
    const past = new Date(Date.now() - 40 * DAY_MS);
    utimesSync(archived, past, past);
    const analysis = writeAnalysisFile(UUID_A);

    const result = await sync(30);

    expect(existsSync(archived)).toBe(false);
    expect(existsSync(analysis)).toBe(false);
    expect(result.pruned).toBe(1);
    expect(result.prunedAnalyses).toBe(1);
  });

  it("無関係なファイル名は無視する", async () => {
    mkdirSync(analysisDir, { recursive: true });
    const other = path.join(analysisDir, "notes.json");
    writeFileSync(other, "{}");
    await sync();
    expect(existsSync(other)).toBe(true);
  });
});

describe("runArchiveSync", () => {
  it("同時呼び出しは1回の同期を共有する（single-flight）", async () => {
    writeLive("-proj-a", UUID_A, "content\n");
    const [r1, r2] = await Promise.all([runArchiveSync(), runArchiveSync()]);
    expect(r1).toBe(r2);
    expect(r1.copied).toBe(1);
  });
});
