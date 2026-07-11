import type { StoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import {
  isPriorityAnalysisResult,
  PRIORITY_JSON_SCHEMA,
} from "@/lib/analysis/priority-types";
import { toolErrorRate } from "@/lib/analysis/metrics";
import { runWithProvider } from "@/lib/analysis/providers";
import type { ProviderRunOutcome } from "@/lib/analysis/providers/types";
import { AnalysisError } from "@/lib/analysis/runner";
import {
  readAllAnalyses,
  readPriorityAnalysis,
  writePriorityAnalysis,
} from "@/lib/analysis/store";
import type { StoredAnalysis } from "@/lib/analysis/types";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";
import { readSettings } from "@/lib/settings/settings";

type RunJsonFn = (
  prompt: string,
  options: { model: string; jsonSchema: object; systemPrompt: string },
  settings: AppSettings,
  config: DashboardConfig,
) => Promise<ProviderRunOutcome>;

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
  "あなたはAIコーディングエージェントの運用（ハーネス設計・使い方）を改善するコーチです。" +
  "渡された複数セッションの振り返り結果（改善アクションの一覧と定量メトリクス）を横断的に分析し、" +
  "品質・作業時間・コストへの影響が最も大きい課題を選定して、具体的な改善アクションを提案してください。" +
  "判断は必ず一覧中の頻度・スコア・数値を根拠にしてください。" +
  "ツールは一切使用せず、指定されたJSONスキーマに従って日本語で出力してください。";

/** 改善点1行に添える定量ダイジェスト（例: 変更+120/-80行・エラー率25%） */
function metricsDigest(analysis: StoredAnalysis): string {
  const m = analysis.metrics;
  const parts = [`変更+${m.estimatedLinesAdded}/-${m.estimatedLinesRemoved}行`];
  const rate = toolErrorRate(m);
  if (rate !== null) parts.push(`エラー率${Math.round(rate * 100)}%`);
  if (m.interruptionCount > 0) parts.push(`割り込み${m.interruptionCount}回`);
  return parts.join("・");
}

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
    .flatMap((analysis) => {
      const s = analysis.result.scores;
      return analysis.result.improvements.map(
        (imp) =>
          `- [${imp.category}] ${imp.action}` +
          `（${analysis.sessionLastAt.slice(0, 10)}・スコア: 計画${s.planning} 文脈${s.contextProvision} 検証${s.verification} 安定${s.trajectoryStability} 範囲${s.scopeDiscipline}・${metricsDigest(analysis)}）`,
      );
    })
    .join("\n");

  return `以下は Claude Code のセッション振り返り（AI分析）で挙がった改善アクションの一覧です（直近${recent.length}セッション分、新しい順）。
各行末尾の括弧内は、そのセッションのハーネス実践スコア（1〜5）とログから機械算出した定量メトリクスです。

=== カテゴリ別頻度 ===
${countLines}

=== 改善アクション一覧 ===
${itemLines}

この一覧を横断的に見て、品質・作業時間・コストへの影響が最も大きく、優先して取り組むべき課題を1〜3件選んでください。各課題について:
- point: 課題の内容
- category: 最も当てはまるカテゴリ
- reason: 最優先と判断した理由（頻度・影響度・数値の観点から具体的に）
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
  model: string | undefined,
  deps: { run: RunJsonFn } = { run: runWithProvider },
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

    const settings = await readSettings(config.settingsPath);
    const provider = settings.analysisProvider;
    // model オーバーライドは claude のみ（haiku/sonnet/opus）。他プロバイダは設定モデル固定
    const resolvedModel =
      provider === "claude"
        ? (model ?? settings.providers.claude.model)
        : settings.providers[provider].model;
    const outcome = await deps.run(
      buildPriorityPrompt(recent),
      {
        model: resolvedModel,
        jsonSchema: PRIORITY_JSON_SCHEMA,
        systemPrompt: SYSTEM_PROMPT,
      },
      settings,
      config,
    );
    if (!isPriorityAnalysisResult(outcome.result)) {
      throw new AnalysisError(
        "分析結果が期待する形式ではありません",
        "invalid-output",
      );
    }

    const stored: StoredPriorityAnalysis = {
      schemaVersion: 2,
      analyzedAt: new Date().toISOString(),
      model: resolvedModel,
      provider,
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
