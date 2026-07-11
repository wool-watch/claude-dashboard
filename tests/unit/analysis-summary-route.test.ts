import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAnalysisSummary } from "@/app/api/analysis/summary/route";
import { writeAnalysis } from "@/lib/analysis/store";
import type { ImprovementCategory, StoredAnalysis } from "@/lib/analysis/types";
import { mkAnalysisResult, mkStoredAnalysis } from "./helpers";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

let baseDir: string;
let analysisDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-asummary-"));
  analysisDir = path.join(baseDir, "analysis");
  process.env.CLAUDE_ANALYSIS_DIR = analysisDir;
});

afterEach(() => {
  delete process.env.CLAUDE_ANALYSIS_DIR;
  rmSync(baseDir, { recursive: true, force: true });
});

const stored = (
  sessionId: string,
  projectId: string,
  category: ImprovementCategory,
): StoredAnalysis =>
  mkStoredAnalysis(sessionId, {
    projectId,
    result: mkAnalysisResult({
      improvements: [{ action: `改善アクション(${projectId})`, category }],
    }),
  });

const req = (url: string) => new NextRequest(`http://127.0.0.1:3947${url}`);

interface SummaryBody {
  analyzedCount: number;
  categoryRanking: { category: string; count: number }[];
}

const fetchSummary = async (url: string): Promise<SummaryBody> => {
  const res = await getAnalysisSummary(req(url));
  expect(res.status).toBe(200);
  return (await res.json()) as SummaryBody;
};

describe("GET /api/analysis/summary の project フィルタ", () => {
  beforeEach(async () => {
    await writeAnalysis(analysisDir, stored(UUID_A, "-proj-a", "計画不足"));
    await writeAnalysis(analysisDir, stored(UUID_B, "-proj-b", "その他"));
  });

  it("project 指定なしは全分析を集計する", async () => {
    const body = await fetchSummary("/api/analysis/summary");
    expect(body.analyzedCount).toBe(2);
  });

  it("?project= で StoredAnalysis.projectId により絞られる", async () => {
    const body = await fetchSummary("/api/analysis/summary?project=-proj-a");
    expect(body.analyzedCount).toBe(1);
    expect(body.categoryRanking[0].category).toBe("計画不足");
    expect(
      body.categoryRanking.some((c) => c.category === "その他" && c.count > 0),
    ).toBe(false);
  });

  it("不存在プロジェクトは0件", async () => {
    const body = await fetchSummary("/api/analysis/summary?project=-proj-zzz");
    expect(body.analyzedCount).toBe(0);
  });
});
