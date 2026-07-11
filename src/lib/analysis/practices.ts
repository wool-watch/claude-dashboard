import type { ImprovementCategory } from "@/lib/analysis/types";
import { SCORE_KEYS } from "@/lib/analysis/types";

export type ScoreKey = (typeof SCORE_KEYS)[number];

/** 優先課題アクションの実施手段の種別 */
export const PRIORITY_ACTION_KINDS = [
  "依頼プロンプト",
  "CLAUDE.md",
  "ワークフロー",
  "設定・ツール",
] as const;
export type PriorityActionKind = (typeof PRIORITY_ACTION_KINDS)[number];

/** ハーネスエンジニアリング / プロジェクト管理のベストプラクティス1件 */
export interface Practice {
  id: string;
  name: string;
  /** 要点1〜2文（プロンプト注入用） */
  summary: string;
  /** 対応する改善点カテゴリ */
  categories: readonly ImprovementCategory[];
  /** 改善が見込めるハーネス実践5軸 */
  scoreKeys: readonly ScoreKey[];
}

/**
 * ベストプラクティスカタログ。
 * 優先課題分析のアクション提案の根拠として LLM プロンプトへ選択注入し、
 * 出力の practice フィールドはこの id から選ばせる。
 */
export const PRACTICES = [
  // --- Claude Code ハーネスエンジニアリング実践 ---
  {
    id: "claude-md",
    name: "CLAUDE.md 整備",
    summary:
      "プロジェクトの規約・ビルド/テストコマンド・注意点を CLAUDE.md に記録し、毎セッション繰り返し伝えている指示を恒久化する。",
    categories: ["指示不足", "コンテキスト不足", "ツール・環境活用"],
    scoreKeys: ["contextProvision"],
  },
  {
    id: "plan-first",
    name: "計画モード・事前計画",
    summary:
      "実装前に計画モード等で方針・変更対象・完了条件を合意してから着手させ、実装後の手戻りを防ぐ。",
    categories: ["計画不足", "仕様・方針変更"],
    scoreKeys: ["planning", "trajectoryStability"],
  },
  {
    id: "tdd-loop",
    name: "TDD・検証ループ",
    summary:
      "先にテスト（期待入出力）を用意して失敗を確認してから実装させ、変更のたびにテスト・動作確認で裏付ける。",
    categories: ["検証不足"],
    scoreKeys: ["verification"],
  },
  {
    id: "context-provide",
    name: "コンテキスト事前提供",
    summary:
      "依頼時に背景・制約・関連ファイル・成功基準を最初にまとめて渡し、エージェントの手探りと誤解を減らす。",
    categories: ["コンテキスト不足", "指示不足"],
    scoreKeys: ["contextProvision"],
  },
  {
    id: "context-manage",
    name: "コンテキスト管理・軌道修正",
    summary:
      "話題が変わったら会話をリセットして焦点を保ち、誤った方向に進んだら早めに中断して具体的に指示し直す。",
    categories: ["コンテキスト不足", "エージェント誤りへの対処"],
    scoreKeys: ["contextProvision", "trajectoryStability"],
  },
  {
    id: "small-scope",
    name: "スコープ分割・小さい依頼",
    summary:
      "大きな変更は独立して検証できる小さな単位に分割して依頼し、1セッション1目的を保つ。",
    categories: ["スコープ超過", "計画不足"],
    scoreKeys: ["scopeDiscipline", "planning"],
  },
  {
    id: "hooks-permissions",
    name: "hooks・permissions 整備",
    summary:
      "フォーマット・テストの自動実行 hooks や許可設定を整備し、確認待ちと検証漏れを仕組みで減らす。",
    categories: ["ツール・環境活用", "検証不足"],
    scoreKeys: ["verification"],
  },
  {
    id: "tooling",
    name: "ツール・環境整備",
    summary:
      "MCP・CLI・スクリプトなどエージェントが自力で検証・操作できる手段を整え、人手での確認や情報提供を減らす。",
    categories: ["ツール・環境活用"],
    scoreKeys: ["verification", "contextProvision"],
  },
  {
    id: "subagents",
    name: "サブエージェント活用",
    summary:
      "調査・レビューなど独立した作業はサブエージェントに切り出し、メイン会話のコンテキストを本題に集中させる。",
    categories: ["スコープ超過", "ツール・環境活用"],
    scoreKeys: ["scopeDiscipline"],
  },
  // --- プロジェクト管理実践 ---
  {
    id: "dod",
    name: "完了条件（DoD）の明文化",
    summary:
      "「何ができたら完了か」（テスト通過・lint 通過・動作確認など）を依頼文に明記し、判断のぶれと検証漏れを防ぐ。",
    categories: ["指示不足", "検証不足"],
    scoreKeys: ["planning", "verification"],
  },
  {
    id: "wbs",
    name: "タスク分解（WBS）",
    summary:
      "成果物を段階的なタスクに分解し、順序と依存関係を決めてから依頼する。1タスクは独立に完了確認できる粒度にする。",
    categories: ["計画不足"],
    scoreKeys: ["planning"],
  },
  {
    id: "timebox",
    name: "タイムボックス",
    summary:
      "作業や調査に時間の上限を決め、超えたら方針を見直す。途中で生じた仕様変更は別タスクに切り出して現タスクを守る。",
    categories: ["仕様・方針変更", "スコープ超過"],
    scoreKeys: ["scopeDiscipline", "trajectoryStability"],
  },
  {
    id: "metrics-retro",
    name: "計測に基づく振り返り",
    summary:
      "エラー率・再編集回数・割り込み回数などの数値を定点観測し、前回の改善アクションの効果を次のセッションで検証する。",
    categories: ["その他", "検証不足"],
    scoreKeys: [
      "planning",
      "contextProvision",
      "verification",
      "trajectoryStability",
      "scopeDiscipline",
    ],
  },
] as const satisfies readonly Practice[];

export type PracticeId = (typeof PRACTICES)[number]["id"];

export const PRACTICE_IDS: readonly PracticeId[] = PRACTICES.map((p) => p.id);

/** UI 表示用: カタログ id からプラクティス名（未知の id は null） */
export function practiceNameOf(id: string): string | null {
  return PRACTICES.find((p) => p.id === id)?.name ?? null;
}

/** プロンプトに注入するプラクティスの既定上限（トークン量を抑える） */
const DEFAULT_PRACTICE_LIMIT = 10;

/**
 * 入力の改善点カテゴリ頻度に関連するプラクティスを選ぶ（決定論的）。
 * 該当カテゴリ頻度の合計 降順・同点はカタログ定義順で最大 limit 件。
 * 交差するものが無ければカタログ先頭から limit 件（注入を空にしない）。
 */
export function selectPractices(
  categoryCounts: ReadonlyMap<string, number>,
  limit: number = DEFAULT_PRACTICE_LIMIT,
): Practice[] {
  const scored = PRACTICES.map((practice, index) => ({
    practice,
    index,
    score: practice.categories.reduce(
      (sum, category) => sum + (categoryCounts.get(category) ?? 0),
      0,
    ),
  })).filter((entry) => entry.score > 0);
  if (scored.length === 0) return PRACTICES.slice(0, limit);
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.practice);
}

/** プロンプト注入用のカタログ一覧テキスト（1件1行） */
export function formatPracticeCatalog(
  practices: readonly Practice[],
): string {
  return practices
    .map(
      (p) =>
        `- [${p.id}] ${p.name}: ${p.summary}（関連カテゴリ: ${p.categories.join("、")}）`,
    )
    .join("\n");
}
