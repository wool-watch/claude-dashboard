import type {
  PriorityAnalysisModel,
  StoredPriorityAnalysis,
} from "@/lib/analysis/priority-types";
import {
  isPriorityAnalysisResult,
  PRIORITY_JSON_SCHEMA,
} from "@/lib/analysis/priority-types";
import type { RunJsonOptions, RunJsonOutcome } from "@/lib/analysis/runner";
import { AnalysisError, runClaudeJson } from "@/lib/analysis/runner";
import {
  readAllAnalyses,
  readPriorityAnalysis,
  writePriorityAnalysis,
} from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";

type RunJsonFn = (
  prompt: string,
  options: RunJsonOptions,
  config: DashboardConfig,
) => Promise<RunJsonOutcome>;

/** 入力に使う振り返り分析の最大件数（sessionLastAt 降順） */
const RECENT_ANALYSES_LIMIT = 20;

declare global {
  // Next.js dev の HMR でモジュールが再評価されても実行中の分析を追跡し続ける
  // キーは projectId（グローバル分析は ""）
  var __claudeDashboardPriorityInflight: Map<string, Promise<unknown>> | undefined;
}

function getInflightMap(): Map<string, Promise<unknown>> {
  // 旧実装（単一 Promise）が HMR で残っていても Map で上書きする
  if (!(globalThis.__claudeDashboardPriorityInflight instanceof Map)) {
    globalThis.__claudeDashboardPriorityInflight = new Map();
  }
  return globalThis.__claudeDashboardPriorityInflight;
}

const inflightKeyOf = (projectId?: string): string => projectId ?? "";

export function isPriorityAnalysisInflight(projectId?: string): boolean {
  return getInflightMap().has(inflightKeyOf(projectId));
}

const SYSTEM_PROMPT =
  "あなたはAIコーディングアシスタント「Claude Code」の利用方法を改善するコーチです。" +
  "渡された複数セッションの振り返り結果（改善点の一覧）を横断的に分析し、" +
  "ユーザーが最も優先して取り組むべき課題を選定して、具体的な改善アクションを提案してください。" +
  "ツールは一切使用せず、指定されたJSONスキーマに従って日本語で出力してください。";

function buildPriorityPrompt(recent: StoredAnalysis[]): string {
  const categoryCounts = new Map<string, number>();
  for (const analysis of recent) {
    for (const imp of analysis.result.improvements) {
      categoryCounts.set(imp.category, (categoryCounts.get(imp.category) ?? 0) + 1);
    }
  }
  const countLines = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `- ${category}: ${count}件`)
    .join("\n");
  const itemLines = recent
    .flatMap((analysis) =>
      analysis.result.improvements.map(
        (imp) =>
          `- [${imp.category}] ${imp.point}` +
          `（${analysis.sessionLastAt.slice(0, 10)}・スコア: 明確さ${analysis.result.scores.instructionClarity} 効率${analysis.result.scores.efficiency} 達成${analysis.result.scores.goalAchievement}）`,
      ),
    )
    .join("\n");

  return `以下は Claude Code のセッション振り返り（AI分析）で挙がった改善点の一覧です（直近${recent.length}セッション分、新しい順）。

=== カテゴリ別頻度 ===
${countLines}

=== 改善点一覧 ===
${itemLines}

この一覧を横断的に見て、最も優先して取り組むべき課題を1〜3件選んでください。各課題について:
- point: 課題の内容
- category: 最も当てはまるカテゴリ
- reason: 最優先と判断した理由（頻度・影響度の観点から具体的に）
- actions: 次のセッションでそのまま実行できる具体的なアクション（1〜5件）
あわせて summary に全体講評（2〜3文）を出力してください。`;
}

/**
 * 保存済みの振り返り分析を横断して優先課題を深掘り分析し、保存する。
 * projectId 指定時はそのプロジェクトの分析のみを入力にし、プロジェクト別に保存する。
 * - 同一対象（グローバル / 同一プロジェクト）の再実行は AnalysisError("in-flight")
 * - 対象の保存済み分析が0件なら AnalysisError("no-analyses")
 */
export async function runPriorityAnalysis(
  model: PriorityAnalysisModel,
  deps: { run: RunJsonFn } = { run: runClaudeJson },
  projectId?: string,
): Promise<StoredPriorityAnalysis> {
  const inflight = getInflightMap();
  const key = inflightKeyOf(projectId);
  if (inflight.has(key)) {
    throw new AnalysisError(
      "優先課題の分析は実行中です。完了までお待ちください",
      "in-flight",
    );
  }
  const promise = (async (): Promise<StoredPriorityAnalysis> => {
    const config = getConfig();
    const all = await readAllAnalyses(config.analysisDir);
    const analyses =
      projectId === undefined
        ? all
        : all.filter((a) => a.projectId === projectId);
    if (analyses.length === 0) {
      throw new AnalysisError(
        projectId === undefined
          ? "保存済みのAI振り返りがありません。先にセッション詳細から分析を実行してください"
          : "このプロジェクトの保存済みAI振り返りがありません。先にセッション詳細から分析を実行してください",
        "no-analyses",
      );
    }
    const recent = [...analyses]
      .sort((a, b) => b.sessionLastAt.localeCompare(a.sessionLastAt))
      .slice(0, RECENT_ANALYSES_LIMIT);

    const outcome = await deps.run(
      buildPriorityPrompt(recent),
      { model, jsonSchema: PRIORITY_JSON_SCHEMA, systemPrompt: SYSTEM_PROMPT },
      config,
    );
    if (!isPriorityAnalysisResult(outcome.result)) {
      throw new AnalysisError(
        "分析結果が期待する形式ではありません",
        "invalid-output",
      );
    }

    const stored: StoredPriorityAnalysis = {
      schemaVersion: 1,
      analyzedAt: new Date().toISOString(),
      model,
      ...(projectId !== undefined && { projectId }),
      analyzedSessionCount: recent.length,
      costUSD: outcome.costUSD,
      result: outcome.result,
    };
    await writePriorityAnalysis(config.analysisDir, stored, projectId);
    return stored;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** 保存済みの優先課題分析（未実行なら null。projectId 指定でプロジェクト別） */
export async function getPriorityAnalysis(
  projectId?: string,
): Promise<StoredPriorityAnalysis | null> {
  return readPriorityAnalysis(getConfig().analysisDir, projectId);
}
