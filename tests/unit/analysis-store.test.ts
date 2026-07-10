import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAllAnalyses,
  readAnalysis,
  readPriorityAnalysis,
  readQueue,
  writeAnalysis,
  writePriorityAnalysis,
  writeQueue,
} from "@/lib/analysis/store";
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

const stored = (sessionId: string): StoredAnalysis => ({
  schemaVersion: 1,
  sessionId,
  projectId: "-proj-a",
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-07-01T00:01:10.000Z",
  costUSD: 0.01,
  result: {
    summary: "要約。",
    goodPoints: ["良い点"],
    improvements: [{ point: "改善点", category: "その他" }],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

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
});

const storedPriority = (): StoredPriorityAnalysis => ({
  schemaVersion: 1,
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "opus",
  analyzedSessionCount: 3,
  costUSD: 0.1,
  result: {
    pickedIssues: [
      {
        point: "タスクを小さく分割すると良い",
        category: "タスク分割",
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
