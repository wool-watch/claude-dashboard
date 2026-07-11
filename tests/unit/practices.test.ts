import { describe, expect, it } from "vitest";
import {
  formatPracticeCatalog,
  PRACTICE_IDS,
  PRACTICES,
  practiceNameOf,
  PRIORITY_ACTION_KINDS,
  selectPractices,
} from "@/lib/analysis/practices";
import { IMPROVEMENT_CATEGORIES, SCORE_KEYS } from "@/lib/analysis/types";

describe("PRACTICES カタログ", () => {
  it("13件あり、id は一意で kebab-case の非空文字列", () => {
    expect(PRACTICES).toHaveLength(13);
    const ids = PRACTICES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("name・summary は非空で、categories・scoreKeys は既知の値のみ", () => {
    for (const p of PRACTICES) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.summary.length).toBeGreaterThan(0);
      expect(p.categories.length).toBeGreaterThan(0);
      expect(p.scoreKeys.length).toBeGreaterThan(0);
      for (const c of p.categories) {
        expect(IMPROVEMENT_CATEGORIES).toContain(c);
      }
      for (const k of p.scoreKeys) {
        expect(SCORE_KEYS).toContain(k);
      }
    }
  });

  it("PRACTICE_IDS はカタログの id と一致する", () => {
    expect(PRACTICE_IDS).toEqual(PRACTICES.map((p) => p.id));
  });

  it("PRIORITY_ACTION_KINDS は4種類", () => {
    expect(PRIORITY_ACTION_KINDS).toEqual([
      "依頼プロンプト",
      "CLAUDE.md",
      "ワークフロー",
      "設定・ツール",
    ]);
  });
});

describe("practiceNameOf", () => {
  it("既知の id は名前を返し、未知の id は null", () => {
    expect(practiceNameOf("plan-first")).toBe("計画モード・事前計画");
    expect(practiceNameOf("unknown-id")).toBeNull();
  });
});

describe("selectPractices", () => {
  it("入力カテゴリと交差するプラクティスを頻度合計の降順で返す", () => {
    const counts = new Map<string, number>([
      ["計画不足", 3],
      ["検証不足", 1],
    ]);
    const selected = selectPractices(counts);
    expect(selected.length).toBeGreaterThan(0);
    // 全件が入力カテゴリのいずれかに対応している
    for (const p of selected) {
      expect(
        p.categories.some((c) => c === "計画不足" || c === "検証不足"),
      ).toBe(true);
    }
    // 頻度3の計画系が先頭（同点はカタログ定義順）で、頻度1の検証系より前
    expect(selected[0].id).toBe("plan-first");
    const ids = selected.map((p) => p.id);
    expect(ids).toContain("wbs");
    expect(ids).toContain("tdd-loop");
    expect(ids.indexOf("wbs")).toBeLessThan(ids.indexOf("tdd-loop"));
  });

  it("交差するものが無ければカタログ先頭から limit 件を返す（注入を空にしない）", () => {
    const selected = selectPractices(new Map());
    expect(selected).toHaveLength(10);
    expect(selected[0].id).toBe(PRACTICES[0].id);
  });

  it("limit で件数を制限できる（既定は10件）", () => {
    const all = new Map<string, number>(
      IMPROVEMENT_CATEGORIES.map((c) => [c, 1]),
    );
    expect(selectPractices(all).length).toBeLessThanOrEqual(10);
    expect(selectPractices(all, 5)).toHaveLength(5);
  });
});

describe("formatPracticeCatalog", () => {
  it("id・名前・要約・関連カテゴリを含む一覧テキストを返す", () => {
    const text = formatPracticeCatalog(PRACTICES);
    expect(text).toContain("[plan-first] 計画モード・事前計画");
    expect(text).toContain("関連カテゴリ");
    // 全プラクティスが1行ずつ含まれる
    for (const p of PRACTICES) {
      expect(text).toContain(`[${p.id}]`);
    }
  });
});
