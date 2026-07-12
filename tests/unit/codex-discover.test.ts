import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { discoverCodexSessions } from "@/lib/sources/codex/discover";

const UUID_A = "019f54b2-2728-71c0-919e-e3b8edf47689";
const UUID_B = "019f54b2-9999-71c0-919e-e3b8edf40000";

let dataDir: string;
let archivedDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "codex-sessions-"));
  archivedDir = mkdtempSync(path.join(os.tmpdir(), "codex-archived-"));
  process.env.CODEX_DATA_DIR = dataDir;
  process.env.CODEX_ARCHIVED_DIR = archivedDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(archivedDir, { recursive: true, force: true });
});

const writeRollout = (root: string, date: string, uuid: string): string => {
  const dir = path.join(root, ...date.split("-"));
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-${date}T05-00-06-${uuid}.jsonl`);
  writeFileSync(filePath, "{}\n");
  return filePath;
};

describe("discoverCodexSessions", () => {
  it("YYYY/MM/DD ツリーを再帰走査し rollout ファイルを見つける", async () => {
    const p1 = writeRollout(dataDir, "2026-07-12", UUID_A);
    const p2 = writeRollout(dataDir, "2026-06-01", UUID_B);
    const found = await discoverCodexSessions(getConfig());
    const byId = new Map(found.map((f) => [f.sessionId, f]));
    expect(byId.size).toBe(2);
    expect(byId.get(UUID_A)?.filePath).toBe(p1);
    expect(byId.get(UUID_A)?.fromArchive).toBe(false);
    expect(byId.get(UUID_B)?.filePath).toBe(p2);
  });

  it("archived_sessions も走査し fromArchive を立てる（ライブ優先で後置）", async () => {
    writeRollout(dataDir, "2026-07-12", UUID_A);
    writeRollout(archivedDir, "2026-07-12", UUID_A);
    writeRollout(archivedDir, "2026-05-01", UUID_B);
    const found = await discoverCodexSessions(getConfig());
    // 同一IDはライブが先に来る（呼び出し側が先勝ちデデュープ）
    const ids = found.map((f) => `${f.sessionId}:${f.fromArchive}`);
    expect(ids.indexOf(`${UUID_A}:false`)).toBeLessThan(
      ids.indexOf(`${UUID_A}:true`),
    );
    expect(found.some((f) => f.sessionId === UUID_B && f.fromArchive)).toBe(true);
  });

  it("rollout 形式でないファイルは無視する", async () => {
    const dir = path.join(dataDir, "2026", "07", "12");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "notes.txt"), "x");
    writeFileSync(path.join(dir, "rollout-bad-name.jsonl"), "{}");
    const found = await discoverCodexSessions(getConfig());
    expect(found).toHaveLength(0);
  });

  it("ダッシュボードアーカイブ（archiveDir/codex）も走査する", async () => {
    const archRoot = path.join(process.env.CLAUDE_ARCHIVE_DIR as string, "codex");
    const p = writeRollout(archRoot, "2026-01-01", UUID_B);
    const found = await discoverCodexSessions(getConfig());
    const hit = found.find((f) => f.sessionId === UUID_B);
    expect(hit?.filePath).toBe(p);
    expect(hit?.fromArchive).toBe(true);
    rmSync(archRoot, { recursive: true, force: true }); // 同一ワーカー内の後続テストを汚さない
  });

  it("ディレクトリ未作成なら空配列", async () => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(archivedDir, { recursive: true, force: true });
    expect(await discoverCodexSessions(getConfig())).toEqual([]);
  });

  it("relPath はルートからの相対パス", async () => {
    writeRollout(dataDir, "2026-07-12", UUID_A);
    const [f] = await discoverCodexSessions(getConfig());
    expect(f.relPath).toBe(
      path.join("2026", "07", "12", `rollout-2026-07-12T05-00-06-${UUID_A}.jsonl`),
    );
  });
});
