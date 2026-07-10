import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalCache } from "@/lib/store/cache";
import {
  getAllSessions,
  getSession,
  getSessionFileRef,
} from "@/lib/store/repository";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const basicJsonl = readFileSync(
  fileURLToPath(new URL("../fixtures/basic-session.jsonl", import.meta.url)),
  "utf8",
);

let tmpDir: string;
let archiveTmpDir: string;
let prevEnv: string | undefined;
let prevArchiveEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-test-"));
  archiveTmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-arch-"));
  prevEnv = process.env.CLAUDE_DATA_DIR;
  prevArchiveEnv = process.env.CLAUDE_ARCHIVE_DIR;
  process.env.CLAUDE_DATA_DIR = tmpDir;
  process.env.CLAUDE_ARCHIVE_DIR = archiveTmpDir;
  getGlobalCache().clear();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.CLAUDE_DATA_DIR;
  else process.env.CLAUDE_DATA_DIR = prevEnv;
  if (prevArchiveEnv === undefined) delete process.env.CLAUDE_ARCHIVE_DIR;
  else process.env.CLAUDE_ARCHIVE_DIR = prevArchiveEnv;
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(archiveTmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const writeSessionFile = (projectId: string, uuid: string, content: string) => {
  const dir = path.join(tmpDir, projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${uuid}.jsonl`), content);
};

const writeArchiveFile = (projectId: string, uuid: string, content: string) => {
  const dir = path.join(archiveTmpDir, projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${uuid}.jsonl`), content);
};

describe("getAllSessions", () => {
  it("プロジェクトディレクトリ配下の UUID.jsonl を列挙する", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    writeSessionFile("-proj-b", UUID_B, basicJsonl);

    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([UUID_A, UUID_B]);
    const a = sessions.find((s) => s.sessionId === UUID_A);
    expect(a?.projectId).toBe("-proj-a");
    expect(a?.turnCount).toBe(2);
  });

  it("非UUID名・.jsonl以外のファイルは無視する", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    writeFileSync(path.join(tmpDir, "-proj-a", "notes.jsonl"), "{}");
    writeFileSync(path.join(tmpDir, "-proj-a", `${UUID_B}.txt`), "x");

    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(1);
  });

  it("dataDir が存在しなければ空配列を返す", async () => {
    process.env.CLAUDE_DATA_DIR = path.join(tmpDir, "does-not-exist");
    expect(await getAllSessions()).toEqual([]);
  });

  it("ファイル変更（mtime/size）で再パースして最新内容を返す", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    const before = await getAllSessions();
    expect(before[0].turnCount).toBe(2);

    // 1ターン追記 + mtime を確実に変える
    const filePath = path.join(tmpDir, "-proj-a", `${UUID_A}.jsonl`);
    const extra =
      '{"type":"user","promptId":"p3","message":{"role":"user","content":"追記"},"uuid":"u9","parentUuid":null,"timestamp":"2026-07-01T00:02:00.000Z","isSidechain":false}\n';
    writeFileSync(filePath, basicJsonl + extra);
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);

    const after = await getAllSessions();
    expect(after[0].turnCount).toBe(3);
  });

  it("削除されたファイルのセッションは消える", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    writeSessionFile("-proj-a", UUID_B, basicJsonl);
    expect(await getAllSessions()).toHaveLength(2);

    rmSync(path.join(tmpDir, "-proj-a", `${UUID_B}.jsonl`));
    expect(await getAllSessions()).toHaveLength(1);
  });

  it("同時呼び出しは走査を1回に共有する（in-flight）", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    const spy = vi.spyOn(fs, "readdir");

    const [r1, r2] = await Promise.all([getAllSessions(), getAllSessions()]);
    expect(r1).toBe(r2); // 同一 Promise の結果

    const rootCalls = spy.mock.calls.filter((c) => c[0] === tmpDir);
    expect(rootCalls).toHaveLength(1);
  });
});

describe("getAllSessions: アーカイブマージ", () => {
  const extraTurn =
    '{"type":"user","promptId":"p3","message":{"role":"user","content":"追記"},"uuid":"u9","parentUuid":null,"timestamp":"2026-07-01T00:02:00.000Z","isSidechain":false}\n';

  it("アーカイブのみに存在するセッションも返す", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    writeArchiveFile("-proj-b", UUID_B, basicJsonl);

    const sessions = await getAllSessions();
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([UUID_A, UUID_B]);
    const b = sessions.find((s) => s.sessionId === UUID_B);
    expect(b?.projectId).toBe("-proj-b");
  });

  it("同一 sessionId はライブ側を優先する", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl + extraTurn); // 3ターン
    writeArchiveFile("-proj-a", UUID_A, basicJsonl); // 2ターン（古い）

    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].turnCount).toBe(3);
  });

  it("dataDir が存在しなくてもアーカイブのセッションを返す", async () => {
    process.env.CLAUDE_DATA_DIR = path.join(tmpDir, "does-not-exist");
    writeArchiveFile("-proj-a", UUID_A, basicJsonl);

    const sessions = await getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(UUID_A);
  });

  it("アーカイブ由来のキャッシュは走査をまたいで保持される", async () => {
    writeArchiveFile("-proj-a", UUID_A, basicJsonl);
    const first = await getAllSessions();
    const second = await getAllSessions();
    // prune で消されず再パースされない = 同一オブジェクトが返る
    expect(second[0]).toBe(first[0]);
  });
});

describe("getAllSessions: ファイルサイズ上限", () => {
  it("MAX_FILE_SIZE_MB を超えるファイルはスキップして警告する", async () => {
    process.env.MAX_FILE_SIZE_MB = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeSessionFile("-proj-a", UUID_A, basicJsonl);
      writeSessionFile("-proj-a", UUID_B, "x".repeat(2 * 1024 * 1024));

      const sessions = await getAllSessions();
      expect(sessions.map((s) => s.sessionId)).toEqual([UUID_A]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      delete process.env.MAX_FILE_SIZE_MB;
    }
  });
});

describe("getSessionFileRef", () => {
  it("ライブのファイルパスと stat を返す", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    const ref = await getSessionFileRef(UUID_A);
    expect(ref?.filePath).toBe(path.join(tmpDir, "-proj-a", `${UUID_A}.jsonl`));
    expect(ref?.projectId).toBe("-proj-a");
    expect(ref?.size).toBe(Buffer.byteLength(basicJsonl));
    expect(ref?.mtimeMs).toBeGreaterThan(0);
  });

  it("アーカイブのみの場合はアーカイブのパスを返す", async () => {
    writeArchiveFile("-proj-b", UUID_B, basicJsonl);
    const ref = await getSessionFileRef(UUID_B);
    expect(ref?.filePath).toBe(
      path.join(archiveTmpDir, "-proj-b", `${UUID_B}.jsonl`),
    );
    expect(ref?.projectId).toBe("-proj-b");
  });

  it("両方に存在する場合はライブ優先", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    writeArchiveFile("-proj-a", UUID_A, basicJsonl);
    const ref = await getSessionFileRef(UUID_A);
    expect(ref?.filePath).toBe(path.join(tmpDir, "-proj-a", `${UUID_A}.jsonl`));
  });

  it("不正UUID・不存在は null", async () => {
    expect(await getSessionFileRef("../etc/passwd")).toBeNull();
    expect(await getSessionFileRef(UUID_A)).toBeNull();
  });
});

describe("getSession", () => {
  it("sessionId で1件取得する", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    const s = await getSession(UUID_A);
    expect(s?.sessionId).toBe(UUID_A);
    expect(s?.title).toBe("テストセッション");
  });

  it("UUID形式でない id は即 null", async () => {
    expect(await getSession("../etc/passwd")).toBeNull();
    expect(await getSession("not-a-uuid")).toBeNull();
  });

  it("存在しない UUID は null", async () => {
    writeSessionFile("-proj-a", UUID_A, basicJsonl);
    expect(await getSession(UUID_B)).toBeNull();
  });
});
