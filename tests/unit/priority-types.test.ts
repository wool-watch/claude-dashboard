import { describe, expect, it } from "vitest";
import { PRACTICE_IDS, PRIORITY_ACTION_KINDS } from "@/lib/analysis/practices";
import {
  isLegacyStoredPriorityAnalysis,
  isPriorityAnalysisResult,
  isStoredPriorityAnalysis,
  parsePriorityAnalysisModel,
  PRIORITY_JSON_SCHEMA,
} from "@/lib/analysis/priority-types";
import { mkPriorityAction, mkPriorityResult } from "./helpers";

const action = mkPriorityAction();

const issue = {
  point: "着手前の計画・タスク分解が不足している",
  category: "計画不足" as const,
  reason: "直近の分析で最も頻出しているため",
  actions: [action],
};

const result = mkPriorityResult({ pickedIssues: [issue] });

const stored = {
  schemaVersion: 3,
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

  it("category 不正（旧カテゴリ含む）は false", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, category: "存在しないカテゴリ" }],
      }),
    ).toBe(false);
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, category: "タスク分割" }], // v1 のカテゴリ
      }),
    ).toBe(false);
  });

  it("actions 0件・4件は false（v3 は 1〜3件）", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, actions: [] }],
      }),
    ).toBe(false);
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [{ ...issue, actions: Array(4).fill(action) }],
      }),
    ).toBe(false);
  });

  it("v2 の文字列 actions は false", () => {
    expect(
      isPriorityAnalysisResult({
        ...result,
        pickedIssues: [
          { ...issue, actions: ["大きな依頼を3ステップに分けて指示する"] },
        ],
      }),
    ).toBe(false);
  });

  it("kind 不正・practice がカタログ外の id は false", () => {
    const withAction = (over: Record<string, unknown>) => ({
      ...result,
      pickedIssues: [{ ...issue, actions: [{ ...action, ...over }] }],
    });
    expect(isPriorityAnalysisResult(withAction({ kind: "不正な種別" }))).toBe(
      false,
    );
    expect(
      isPriorityAnalysisResult(withAction({ practice: "unknown-practice" })),
    ).toBe(false);
  });

  it("title・how・expectedEffect の空文字は false", () => {
    const withAction = (over: Record<string, unknown>) => ({
      ...result,
      pickedIssues: [{ ...issue, actions: [{ ...action, ...over }] }],
    });
    expect(isPriorityAnalysisResult(withAction({ title: "" }))).toBe(false);
    expect(isPriorityAnalysisResult(withAction({ how: "" }))).toBe(false);
    expect(isPriorityAnalysisResult(withAction({ expectedEffect: "" }))).toBe(
      false,
    );
  });

  it("snippet は空文字を許容し、欠損・非文字列は false", () => {
    const withAction = (a: Record<string, unknown>) => ({
      ...result,
      pickedIssues: [{ ...issue, actions: [a] }],
    });
    expect(isPriorityAnalysisResult(withAction({ ...action, snippet: "" }))).toBe(
      true,
    );
    expect(
      isPriorityAnalysisResult(
        withAction({ ...action, snippet: "- 変更後は npm test を実行する" }),
      ),
    ).toBe(true);
    const { snippet: _snippet, ...withoutSnippet } = action;
    expect(isPriorityAnalysisResult(withAction(withoutSnippet))).toBe(false);
    expect(isPriorityAnalysisResult(withAction({ ...action, snippet: 1 }))).toBe(
      false,
    );
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

  it("schemaVersion 不一致（旧 v1・v2 含む）は false", () => {
    expect(isStoredPriorityAnalysis({ ...stored, schemaVersion: 99 })).toBe(false);
    expect(isStoredPriorityAnalysis({ ...stored, schemaVersion: 1 })).toBe(false);
    expect(isStoredPriorityAnalysis({ ...stored, schemaVersion: 2 })).toBe(false);
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

describe("isLegacyStoredPriorityAnalysis", () => {
  it("v1・v2 の保存形式は true（旧形式 = 再分析案内の対象）", () => {
    const legacyV2 = {
      schemaVersion: 2,
      analyzedAt: "2026-07-01T00:00:00.000Z",
      model: "sonnet",
      analyzedSessionCount: 5,
      costUSD: null,
      result: {
        pickedIssues: [
          {
            point: "課題",
            category: "計画不足",
            reason: "理由",
            actions: ["旧形式のアクション"],
          },
        ],
        summary: "講評。",
      },
    };
    expect(isLegacyStoredPriorityAnalysis(legacyV2)).toBe(true);
    expect(
      isLegacyStoredPriorityAnalysis({ ...legacyV2, schemaVersion: 1 }),
    ).toBe(true);
  });

  it("v3・未知バージョン・非オブジェクトは false", () => {
    expect(isLegacyStoredPriorityAnalysis(stored)).toBe(false);
    expect(
      isLegacyStoredPriorityAnalysis({ schemaVersion: 99, analyzedAt: "x" }),
    ).toBe(false);
    expect(isLegacyStoredPriorityAnalysis(null)).toBe(false);
    expect(isLegacyStoredPriorityAnalysis("v2")).toBe(false);
  });

  it("analyzedAt が無いものは false（別ファイル種の誤検知防止）", () => {
    expect(isLegacyStoredPriorityAnalysis({ schemaVersion: 2 })).toBe(false);
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

  it("actions は6フィールド全て必須のオブジェクト（strict モード対応）", () => {
    const actionsSchema =
      PRIORITY_JSON_SCHEMA.properties.pickedIssues.items.properties.actions;
    expect(actionsSchema.items.required).toEqual([
      "title",
      "kind",
      "practice",
      "how",
      "expectedEffect",
      "snippet",
    ]);
    expect(actionsSchema.items.additionalProperties).toBe(false);
    expect(actionsSchema.maxItems).toBe(3);
  });

  it("kind・practice はカタログの enum に一致する", () => {
    const props =
      PRIORITY_JSON_SCHEMA.properties.pickedIssues.items.properties.actions.items
        .properties;
    expect(props.kind.enum).toEqual([...PRIORITY_ACTION_KINDS]);
    expect(props.practice.enum).toEqual([...PRACTICE_IDS]);
  });
});
