import type { SessionMetrics } from "@/lib/analysis/metrics";
import type {
  PriorityAction,
  PriorityAnalysisResult,
} from "@/lib/analysis/priority-types";
import type { AnalysisResult, StoredAnalysis } from "@/lib/analysis/types";
import {
  addUsage,
  emptyUsage,
  type SessionDetail,
  type Turn,
  type UsageTotals,
} from "@/lib/types";

export const mkMetrics = (over: Partial<SessionMetrics> = {}): SessionMetrics => ({
  editedFileCount: 3,
  editOpCount: 4,
  estimatedLinesAdded: 120,
  estimatedLinesRemoved: 80,
  interruptionCount: 1,
  reEditedFileCount: 1,
  maxEditsPerFile: 2,
  toolResultCount: 8,
  toolErrorCount: 2,
  testRunCount: 2,
  testFailCount: 1,
  durationMs: 3_600_000,
  activeTimeMs: 1_800_000,
  costUSD: 2,
  totalTokens: 100_000,
  inputTokens: 10_000,
  cacheReadTokens: 40_000,
  sidechainMessageCount: 0,
  turnCount: 5,
  ...over,
});

export const mkAnalysisResult = (
  over: Partial<AnalysisResult> = {},
): AnalysisResult => ({
  summary: "要約。",
  goodPoints: ["良い点"],
  improvements: [
    { action: "着手前に完了条件と対象ファイル一覧を提示させる", category: "計画不足" },
  ],
  scores: {
    planning: 4,
    contextProvision: 3,
    verification: 5,
    trajectoryStability: 4,
    scopeDiscipline: 3,
  },
  ...over,
});

export const mkStoredAnalysis = (
  sessionId: string,
  over: Partial<StoredAnalysis> = {},
): StoredAnalysis => ({
  schemaVersion: 2,
  sessionId,
  projectId: "-proj-a",
  analyzedAt: "2026-07-10T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-07-01T00:01:10.000Z",
  costUSD: 0.01,
  metrics: mkMetrics(),
  result: mkAnalysisResult(),
  ...over,
});

export const mkPriorityAction = (
  over: Partial<PriorityAction> = {},
): PriorityAction => ({
  title: "計画モードで方針を合意してから着手する",
  kind: "ワークフロー",
  practice: "plan-first",
  how: "実装依頼の前に計画モードで変更対象と完了条件を提示させ、合意してから実装に進める",
  expectedEffect: "計画スコア（平均2）の改善と割り込み回数の減少が見込める",
  snippet: "",
  ...over,
});

export const mkPriorityResult = (
  over: Partial<PriorityAnalysisResult> = {},
): PriorityAnalysisResult => ({
  pickedIssues: [
    {
      point: "着手前の計画・タスク分解が不足している",
      category: "計画不足",
      reason: "直近の分析で最も頻出し、計画スコアの平均も低いため",
      actions: [mkPriorityAction()],
    },
  ],
  summary: "全体講評。",
  ...over,
});

/** 移行前に保存されていた v1 形式（テスト用の生 JSON） */
export const mkLegacyStoredJson = (
  sessionId: string,
  projectId = "-proj-a",
): Record<string, unknown> => ({
  schemaVersion: 1,
  sessionId,
  projectId,
  analyzedAt: "2026-06-01T00:00:00.000Z",
  model: "haiku",
  sourceMtimeMs: 1000,
  sourceSize: 500,
  sessionLastAt: "2026-05-31T00:00:00.000Z",
  costUSD: null,
  result: {
    summary: "旧形式の分析",
    goodPoints: ["良かった点"],
    improvements: [
      { point: "テスト方針を最初に共有すると良い", category: "テスト・検証" },
    ],
    scores: { instructionClarity: 4, efficiency: 3, goalAchievement: 5 },
  },
});

export const usageOf = (input: number, output = 0): UsageTotals => ({
  ...emptyUsage(),
  inputTokens: input,
  outputTokens: output,
});

export function mkTurn(startedAt: string, over: Partial<Turn> = {}): Turn {
  const usage = over.usage ?? usageOf(1000);
  return {
    promptId: "p",
    userText: "質問",
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    activeTimeMs: 60_000,
    models: ["claude-opus-4-8"],
    perModelUsage: { "claude-opus-4-8": usage },
    perModelRequests: { "claude-opus-4-8": 1 },
    toolCounts: {},
    usage,
    costUSD: 0.01,
    costIsEstimated: false,
    assistantMessageCount: 2,
    hasSidechain: false,
    ...over,
  };
}

export function mkSession(
  sessionId: string,
  turns: Turn[],
  over: Partial<SessionDetail> = {},
): SessionDetail {
  let usage = emptyUsage();
  let costUSD = 0;
  for (const t of turns) {
    usage = addUsage(usage, t.usage);
    costUSD += t.costUSD;
  }
  return {
    sessionId,
    projectId: "-proj",
    projectPath: "/home/test/proj",
    title: "テストセッション",
    firstAt: turns[0]?.startedAt ?? "",
    lastAt: turns[turns.length - 1]?.startedAt ?? "",
    turnCount: turns.length,
    messageCount: turns.length * 3,
    sidechainMessageCount: 0,
    models: ["claude-opus-4-8"],
    usage,
    costUSD,
    costIsEstimated: false,
    activeTimeMs: turns.reduce((a, t) => a + t.activeTimeMs, 0),
    version: null,
    gitBranch: null,
    turns,
    skippedLines: 0,
    ...over,
  };
}
