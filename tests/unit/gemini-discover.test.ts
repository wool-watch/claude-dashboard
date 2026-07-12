import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { discoverGeminiSessions } from "@/lib/sources/gemini/discover";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "gemini-tmp-"));
  process.env.GEMINI_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const writeChat = (hash: string, fileName: string): string => {
  const dir = path.join(dataDir, hash, "chats");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, "{}\n");
  return filePath;
};

describe("discoverGeminiSessions", () => {
  it("<hash>/chats/session-*.jsonl を見つけ projectHash を保持する", async () => {
    const p1 = writeChat("hash-a", "session-2026-07-12T07-00-abcd1234.jsonl");
    const p2 = writeChat("hash-b", "session-2026-07-11T01-00-ef567890.jsonl");
    const found = await discoverGeminiSessions(getConfig());
    expect(found).toHaveLength(2);
    const byPath = new Map(found.map((f) => [f.filePath, f]));
    expect(byPath.get(p1)?.projectHash).toBe("hash-a");
    expect(byPath.get(p2)?.projectHash).toBe("hash-b");
    expect(byPath.get(p1)?.relPath).toBe(
      path.join("hash-a", "chats", "session-2026-07-12T07-00-abcd1234.jsonl"),
    );
  });

  it("session- プレフィックス以外（checkpoint・logs・サブエージェント）は無視する", async () => {
    writeChat("hash-a", "checkpoint-mytag.json");
    writeChat("hash-a", "3f2b8c1d-aaaa-bbbb-cccc-0123456789ab.jsonl");
    const dir = path.join(dataDir, "hash-a");
    writeFileSync(path.join(dir, "logs.json"), "{}");
    const found = await discoverGeminiSessions(getConfig());
    expect(found).toEqual([]);
  });

  it("ディレクトリ未作成なら空配列", async () => {
    rmSync(dataDir, { recursive: true, force: true });
    expect(await discoverGeminiSessions(getConfig())).toEqual([]);
  });
});
