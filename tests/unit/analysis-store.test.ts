import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAllAnalyses,
  readAnalysis,
  writeAnalysis,
} from "@/lib/analysis/store";
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
});
