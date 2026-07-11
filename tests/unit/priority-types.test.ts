import { describe, expect, it } from "vitest";
import {
  isPriorityAnalysisResult,
  isStoredPriorityAnalysis,
  parsePriorityAnalysisModel,
  PRIORITY_JSON_SCHEMA,
} from "@/lib/analysis/priority-types";

const issue = {
  point: "タスクを小さく分割すると良い",
  category: "タスク分割",
  reason: "直近の分析で最も頻出しているため",
  actions: ["大きな依頼を3ステップに分けて指示する"],
};

const result = { pickedIssues: [issue], summary: "全体講評。" };

const stored = {
  schemaVersion: 1,
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "opus",
  analyzedSessionCount: 5,
  costUSD: 0.1,
  result,
};

describe("isPriorityAnalysisResult", () => {
  it("正常な結果は true（1〜3件）", () => {
    expect(isPriorityAnalysisResult(result)).toBe(true);
    expect(
      isPriorityAnalysisResult({ ...result, pickedIssues: [issue, issue, issue] }),
    ).toBe(true);
  });

  it("pickedIssues 0件・4件は false", () => {
    expect(isPriorityAnalysisResult({ ...result, pickedIssues: [] })).toBe(false);
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [issue, issue, issue, issue],
      }),
    ).toBe(false);
  });

  it("category 不正は false", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, category: "存在しないカテゴリ" }],
      }),
    ).toBe(false);
  });

  it("actions 空・6件は false", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, actions: [] }],
      }),
    ).toBe(false);
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, actions: Array(6).fill("a") }],
      }),
    ).toBe(false);
  });

  it("reason・summary 空文字は false", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, reason: "" }],
      }),
    ).toBe(false);
    expect(isPriorityAnalysisResult({ ...result, summary: "" })).toBe(false);
  });
});

describe("isStoredPriorityAnalysis", () => {
  it("正常な保存形式は true（costUSD null も可）", () => {
    expect(isStoredPriorityAnalysis(stored)).toBe(true);
    expect(isStoredPriorityAnalysis({ ...stored, costUSD: null })).toBe(true);
    expect(isStoredPriorityAnalysis({ ...stored, model: "haiku" })).toBe(true);
  });

  it("schemaVersion 不一致は false", () => {
    expect(isStoredPriorityAnalysis({ ...stored, schemaVersion: 99 })).toBe(false);
  });

  it("model は任意の非空文字列を受理し、空文字・非文字列は false", () => {
    expect(isStoredPriorityAnalysis({ ...stored, model: "gpt" })).toBe(true);
    expect(isStoredPriorityAnalysis({ ...stored, model: "" })).toBe(false);
    expect(isStoredPriorityAnalysis({ ...stored, model: 5 })).toBe(false);
  });

  it("provider は省略可（旧データ互換）・既知IDのみ受理する", () => {
    expect(isStoredPriorityAnalysis(stored)).toBe(true); // provider 欠損 = 旧データ
    expect(isStoredPriorityAnalysis({ ...stored, provider: "gemini" })).toBe(true);
    expect(isStoredPriorityAnalysis({ ...stored, provider: "chatgpt" })).toBe(false);
  });

  it("projectId は文字列を許容し、非文字列は false", () => {
    expect(isStoredPriorityAnalysis({ ...stored, projectId: "-proj-a" })).toBe(true);
    expect(isStoredPriorityAnalysis({ ...stored, projectId: 123 })).toBe(false);
  });
});

describe("parsePriorityAnalysisModel", () => {
  it("haiku/sonnet/opus を受理し、それ以外は null", () => {
    expect(parsePriorityAnalysisModel("haiku")).toBe("haiku");
    expect(parsePriorityAnalysisModel("sonnet")).toBe("sonnet");
    expect(parsePriorityAnalysisModel("opus")).toBe("opus");
    expect(parsePriorityAnalysisModel("gpt")).toBeNull();
    expect(parsePriorityAnalysisModel(undefined)).toBeNull();
  });
});

describe("PRIORITY_JSON_SCHEMA", () => {
  it("pickedIssues と summary を必須にしている", () => {
    expect(PRIORITY_JSON_SCHEMA.required).toContain("pickedIssues");
    expect(PRIORITY_JSON_SCHEMA.required).toContain("summary");
  });
});
