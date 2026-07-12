import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isLegacyPriorityAnalysisFile,
  readAllAnalyses,
  readAnalysis,
  readLegacyAnalysisRefs,
  readPriorityAnalysis,
  readQueue,
  writeAnalysis,
  writePriorityAnalysis,
  writeQueue,
} from "@/lib/analysis/store";
import { mkLegacyStoredJson, mkPriorityResult, mkStoredAnalysis } from "./helpers";
import type { StoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import { EMPTY_QUEUE, type StoredQueue } from "@/lib/analysis/queue-types";
import type { StoredAnalysis } from "@/lib/analysis/types";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

let baseDir: string;
let analysisDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-analysis-"));
  analysisDir = path.join(baseDir, "analysis"); // 未作成状態から開始
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const stored = (sessionId: string): StoredAnalysis => mkStoredAnalysis(sessionId);

describe("writeAnalysis / readAnalysis", () => {
  it("書き込んだ分析を読み戻せる（ディレクトリ自動作成）", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    expect(await readAnalysis(analysisDir, UUID_A)).toEqual(stored(UUID_A));
  });

  it("一時ファイルを残さない", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    expect(readdirSync(analysisDir)).toEqual([`${UUID_A}.json`]);
  });

  it("未分析の sessionId は null", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    expect(await readAnalysis(analysisDir, UUID_B)).toBeNull();
  });

  it("破損したJSONは null", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    writeFileSync(path.join(analysisDir, `${UUID_B}.json`), "{broken");
    expect(await readAnalysis(analysisDir, UUID_B)).toBeNull();
  });

  it("型ガード不合格（schemaVersion違い）は null", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    writeFileSync(
      path.join(analysisDir, `${UUID_B}.json`),
      JSON.stringify({ ...stored(UUID_B), schemaVersion: 99 }),
    );
    expect(await readAnalysis(analysisDir, UUID_B)).toBeNull();
  });

  it("パストラバーサルは null", async () => {
    expect(await readAnalysis(analysisDir, "../etc/passwd")).toBeNull();
    expect(await readAnalysis(analysisDir, "not-a-uuid")).toBeNull();
  });
});

describe("readAllAnalyses", () => {
  it("ディレクトリ未作成なら空配列", async () => {
    expect(await readAllAnalyses(analysisDir)).toEqual([]);
  });

  it("正常ファイルのみ返し、不正・無関係ファイルはスキップする", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    await writeAnalysis(analysisDir, stored(UUID_B));
    writeFileSync(path.join(analysisDir, "notes.json"), "{}"); // 非UUID名
    writeFileSync(
      path.join(analysisDir, "33333333-3333-3333-3333-333333333333.json"),
      "{broken",
    );

    const all = await readAllAnalyses(analysisDir);
    expect(all.map((a) => a.sessionId).sort()).toEqual([UUID_A, UUID_B]);
  });

  it("priority-analysis.json は無視する", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    await writePriorityAnalysis(analysisDir, storedPriority());

    const all = await readAllAnalyses(analysisDir);
    expect(all.map((a) => a.sessionId)).toEqual([UUID_A]);
  });

  it("旧 v1 形式のファイルはスキップする", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    writeFileSync(
      path.join(analysisDir, `${UUID_B}.json`),
      JSON.stringify(mkLegacyStoredJson(UUID_B)),
    );

    const all = await readAllAnalyses(analysisDir);
    expect(all.map((a) => a.sessionId)).toEqual([UUID_A]);
  });
});

describe("readLegacyAnalysisRefs", () => {
  it("ディレクトリ未作成なら空配列", async () => {
    expect(await readLegacyAnalysisRefs(analysisDir)).toEqual([]);
  });

  it("v1 ファイルの sessionId / projectId を返し、v2・破損・無関係ファイルは無視する", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A)); // v2
    writeFileSync(
      path.join(analysisDir, `${UUID_B}.json`),
      JSON.stringify(mkLegacyStoredJson(UUID_B, "-proj-b")),
    );
    writeFileSync(
      path.join(analysisDir, "33333333-3333-3333-3333-333333333333.json"),
      "{broken",
    );
    writeFileSync(path.join(analysisDir, "notes.json"), "{}");

    expect(await readLegacyAnalysisRefs(analysisDir)).toEqual([
      { sessionId: UUID_B, projectId: "-proj-b" },
    ]);
  });
});

const storedPriority = (): StoredPriorityAnalysis => ({
  schemaVersion: 3,
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "opus",
  analyzedSessionCount: 3,
  costUSD: 0.1,
  result: mkPriorityResult(),
});

/** 移行前に保存されていた v2 形式（テスト用の生 JSON） */
const legacyPriorityJson = (): Record<string, unknown> => ({
  schemaVersion: 2,
  analyzedAt: "2026-07-01T00:00:00.000Z",
  model: "sonnet",
  analyzedSessionCount: 3,
  costUSD: 0.1,
  result: {
    pickedIssues: [
      {
        point: "タスクを小さく分割すると良い",
        category: "計画不足",
        reason: "頻出のため",
        actions: ["依頼を3ステップに分ける"],
      },
    ],
    summary: "全体講評。",
  },
});

describe("writePriorityAnalysis / readPriorityAnalysis", () => {
  it("書き込んだ結果を読み戻せる（ディレクトリ自動作成・上書き）", async () => {
    await writePriorityAnalysis(analysisDir, storedPriority());
    expect(await readPriorityAnalysis(analysisDir)).toEqual(storedPriority());

    const updated = { ...storedPriority(), analyzedSessionCount: 9 };
    await writePriorityAnalysis(analysisDir, updated);
    expect((await readPriorityAnalysis(analysisDir))?.analyzedSessionCount).toBe(9);
  });

  it("一時ファイルを残さない", async () => {
    await writePriorityAnalysis(analysisDir, storedPriority());
    expect(readdirSync(analysisDir)).toEqual(["priority-analysis.json"]);
  });

  it("未保存・破損・型ガード不合格は null", async () => {
    expect(await readPriorityAnalysis(analysisDir)).toBeNull();

    await writePriorityAnalysis(analysisDir, storedPriority());
    writeFileSync(path.join(analysisDir, "priority-analysis.json"), "{broken");
    expect(await readPriorityAnalysis(analysisDir)).toBeNull();

    writeFileSync(
      path.join(analysisDir, "priority-analysis.json"),
      JSON.stringify({ ...storedPriority(), schemaVersion: 99 }),
    );
    expect(await readPriorityAnalysis(analysisDir)).toBeNull();
  });
});

describe("writePriorityAnalysis / readPriorityAnalysis（プロジェクト別）", () => {
  it("projectId 指定で別ファイルに保存されグローバルと独立", async () => {
    await writePriorityAnalysis(analysisDir, storedPriority());
    const forProject = {
      ...storedPriority(),
      projectId: "-proj-a",
      analyzedSessionCount: 7,
    };
    await writePriorityAnalysis(analysisDir, forProject, "-proj-a");

    expect(
      existsSync(path.join(analysisDir, "priority-analysis.-proj-a.json")),
    ).toBe(true);
    expect(
      (await readPriorityAnalysis(analysisDir, "-proj-a"))?.analyzedSessionCount,
    ).toBe(7);
    // グローバルは従来ファイル・従来値のまま
    expect(
      (await readPriorityAnalysis(analysisDir))?.analyzedSessionCount,
    ).toBe(3);
  });

  it("不正な projectId は read で null（パストラバーサル防止）", async () => {
    expect(await readPriorityAnalysis(analysisDir, "../etc")).toBeNull();
    expect(await readPriorityAnalysis(analysisDir, "a/b")).toBeNull();
    expect(await readPriorityAnalysis(analysisDir, "")).toBeNull();
  });

  it("readAllAnalyses はプロジェクト別ファイルも無視する", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    await writePriorityAnalysis(
      analysisDir,
      { ...storedPriority(), projectId: "-proj-a" },
      "-proj-a",
    );

    const all = await readAllAnalyses(analysisDir);
    expect(all.map((a) => a.sessionId)).toEqual([UUID_A]);
  });
});

describe("isLegacyPriorityAnalysisFile", () => {
  it("旧 v2 ファイルは true になり、readPriorityAnalysis は null", async () => {
    await writePriorityAnalysis(analysisDir, storedPriority()); // ディレクトリ作成
    writeFileSync(
      path.join(analysisDir, "priority-analysis.json"),
      JSON.stringify(legacyPriorityJson()),
    );
    expect(await readPriorityAnalysis(analysisDir)).toBeNull();
    expect(await isLegacyPriorityAnalysisFile(analysisDir)).toBe(true);
  });

  it("プロジェクト別ファイルも判定でき、グローバルとは独立", async () => {
    await writePriorityAnalysis(analysisDir, storedPriority());
    writeFileSync(
      path.join(analysisDir, "priority-analysis.-proj-a.json"),
      JSON.stringify(legacyPriorityJson()),
    );
    expect(await isLegacyPriorityAnalysisFile(analysisDir, "-proj-a")).toBe(true);
    expect(await isLegacyPriorityAnalysisFile(analysisDir)).toBe(false); // v3
  });

  it("v3・未保存・破損・不正 projectId は false", async () => {
    expect(await isLegacyPriorityAnalysisFile(analysisDir)).toBe(false); // 未保存

    await writePriorityAnalysis(analysisDir, storedPriority());
    expect(await isLegacyPriorityAnalysisFile(analysisDir)).toBe(false); // v3

    writeFileSync(path.join(analysisDir, "priority-analysis.json"), "{broken");
    expect(await isLegacyPriorityAnalysisFile(analysisDir)).toBe(false);
    expect(await isLegacyPriorityAnalysisFile(analysisDir, "../etc")).toBe(false);
  });
});

const storedQueue = (): StoredQueue => ({
  schemaVersion: 1,
  paused: true,
  items: [
    {
      sessionId: UUID_A,
      state: "pending",
      enqueuedAt: "2026-07-10T00:00:00.000Z",
    },
  ],
});

describe("writeQueue / readQueue", () => {
  it("書き込んだキューを読み戻せる（ディレクトリ自動作成・上書き）", async () => {
    await writeQueue(analysisDir, storedQueue());
    expect(await readQueue(analysisDir)).toEqual(storedQueue());

    const updated = { ...storedQueue(), paused: false };
    await writeQueue(analysisDir, updated);
    expect((await readQueue(analysisDir)).paused).toBe(false);
  });

  it("一時ファイルを残さない", async () => {
    await writeQueue(analysisDir, storedQueue());
    expect(readdirSync(analysisDir)).toEqual(["analysis-queue.json"]);
  });

  it("欠損・破損・型ガード不合格は EMPTY_QUEUE", async () => {
    expect(await readQueue(analysisDir)).toEqual(EMPTY_QUEUE);

    await writeQueue(analysisDir, storedQueue());
    writeFileSync(path.join(analysisDir, "analysis-queue.json"), "{broken");
    expect(await readQueue(analysisDir)).toEqual(EMPTY_QUEUE);

    writeFileSync(
      path.join(analysisDir, "analysis-queue.json"),
      JSON.stringify({ ...storedQueue(), schemaVersion: 99 }),
    );
    expect(await readQueue(analysisDir)).toEqual(EMPTY_QUEUE);
  });

  it("readAllAnalyses は analysis-queue.json を無視する", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    await writeQueue(analysisDir, storedQueue());

    const all = await readAllAnalyses(analysisDir);
    expect(all.map((a) => a.sessionId)).toEqual([UUID_A]);
  });
});

describe("マルチソース: StoredAnalysis v3 と sessionKey ファイル名", () => {
  const codexId = "019f54b2-2728-71c0-919e-e3b8edf47689";

  it("source 付き v3 は <source>--<id>.json に保存され sessionKey で読める", async () => {
    const a = mkStoredAnalysis(codexId, { schemaVersion: 3, source: "codex" });
    await writeAnalysis(analysisDir, a);
    expect(existsSync(path.join(analysisDir, `codex--${codexId}.json`))).toBe(
      true,
    );
    const read = await readAnalysis(analysisDir, `codex:${codexId}`);
    expect(read?.sessionId).toBe(codexId);
    expect(read?.source).toBe("codex");
  });

  it("v2（source なし）は従来どおり素のUUIDで読める（後方互換）", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    const read = await readAnalysis(analysisDir, UUID_A);
    expect(read?.schemaVersion).toBe(2);
    expect(read?.source).toBeUndefined();
  });

  it("readAllAnalyses は両形式のファイルを拾う", async () => {
    await writeAnalysis(analysisDir, stored(UUID_A));
    await writeAnalysis(
      analysisDir,
      mkStoredAnalysis(codexId, { schemaVersion: 3, source: "gemini" }),
    );
    const all = await readAllAnalyses(analysisDir);
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.source ?? "claude").sort()).toEqual([
      "claude",
      "gemini",
    ]);
  });
});
