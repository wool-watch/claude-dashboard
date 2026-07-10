import { readFileSync } from "node:fs";
import type { RunOutcome } from "@/lib/analysis/runner";
import { AnalysisError, runClaudeAnalysis } from "@/lib/analysis/runner";
import { readAllAnalyses, readAnalysis, writeAnalysis } from "@/lib/analysis/store";
import { buildTranscript } from "@/lib/analysis/transcript";
import type { StoredAnalysis } from "@/lib/analysis/types";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { AnalysisModel } from "@/lib/settings/settings";
import { readSettings } from "@/lib/settings/settings";
import { getSession, getSessionFileRef } from "@/lib/store/repository";

export interface AnalysisWithStaleness {
  analysis: StoredAnalysis | null;
  isStale: boolean;
}

type RunFn = (
  prompt: string,
  model: AnalysisModel,
  config: DashboardConfig,
) => Promise<RunOutcome>;

declare global {
  // Next.js dev の HMR でモジュールが再評価されても実行中の分析を追跡し続ける
  var __claudeDashboardAnalysisInflight: Map<string, Promise<unknown>> | undefined;
}

function getInflightMap(): Map<string, Promise<unknown>> {
  globalThis.__claudeDashboardAnalysisInflight ??= new Map();
  return globalThis.__claudeDashboardAnalysisInflight;
}

function buildPrompt(transcript: string): string {
  return `以下は Claude Code のセッション（ユーザーとアシスタントのやり取り）の記録です。
[USER] がユーザーの指示、[ASSISTANT] がアシスタントの応答（使用ツール付き）です。

この記録を分析し、次の観点で振り返りを出力してください:
- summary: セッション全体で何をしようとし、どう進んだかの要約（2〜3文）
- goodPoints: ユーザーの指示・進め方で効果的だった点（具体的な発言を根拠に）
- improvements: 次回のセッションをより良くするための改善点。各項目に最も当てはまるカテゴリを付けること
- scores: 指示の明確さ(instructionClarity)・進行の効率(efficiency)・目的の達成度(goalAchievement)を1〜5の整数で

注意:
- 改善点は「〜すると良い」の形で、次のセッションでそのまま実行できる具体性で書くこと
- 記録が途中で省略されている場合（「（中略）」「（省略）」マーカー）は、見えている範囲で判断すること

=== セッション記録 ===
${transcript}`;
}

/**
 * セッションを分析して保存する。
 * - セッションが存在しなければ null（呼出側で404）
 * - 実行中の同一セッションは AnalysisError("in-flight")
 * - 本線のユーザー発話が無ければ AnalysisError("no-conversation")
 */
export async function analyzeSession(
  sessionId: string,
  deps: { run: RunFn } = { run: runClaudeAnalysis },
): Promise<StoredAnalysis | null> {
  const inflight = getInflightMap();
  if (inflight.has(sessionId)) {
    throw new AnalysisError(
      "このセッションは分析実行中です。完了までお待ちください",
      "in-flight",
    );
  }
  const promise = (async (): Promise<StoredAnalysis | null> => {
    const config = getConfig();
    const session = await getSession(sessionId);
    if (session === null) return null;
    const ref = await getSessionFileRef(sessionId);
    if (ref === null) return null;

    const transcript = buildTranscript(
      readFileSync(ref.filePath, "utf8"),
      config,
    );
    if (transcript.userTurnCount === 0) {
      throw new AnalysisError(
        "分析対象の会話がありません（本線のユーザー発話が0件）",
        "no-conversation",
      );
    }

    const settings = await readSettings(config.settingsPath);
    const outcome = await deps.run(
      buildPrompt(transcript.text),
      settings.analysisModel,
      config,
    );

    const stored: StoredAnalysis = {
      schemaVersion: 1,
      sessionId,
      projectId: ref.projectId,
      analyzedAt: new Date().toISOString(),
      model: settings.analysisModel,
      sourceMtimeMs: ref.mtimeMs,
      sourceSize: ref.size,
      sessionLastAt: session.lastAt,
      costUSD: outcome.costUSD,
      result: outcome.result,
    };
    await writeAnalysis(config.analysisDir, stored);
    return stored;
  })().finally(() => {
    inflight.delete(sessionId);
  });
  inflight.set(sessionId, promise);
  return promise;
}

/**
 * 保存済み分析と鮮度を返す。
 * - 分析もセッションも無ければ null
 * - セッションファイルが分析時点から変化（または消滅）していれば isStale: true
 */
export async function getAnalysisWithStaleness(
  sessionId: string,
): Promise<AnalysisWithStaleness | null> {
  const config = getConfig();
  const analysis = await readAnalysis(config.analysisDir, sessionId);
  const ref = await getSessionFileRef(sessionId);
  if (analysis === null) {
    return ref === null ? null : { analysis: null, isStale: false };
  }
  const isStale =
    ref === null ||
    Math.abs(ref.mtimeMs - analysis.sourceMtimeMs) >= 2 ||
    ref.size !== analysis.sourceSize;
  return { analysis, isStale };
}

/** ダッシュボード集計用: 保存済み分析の全件読出し */
export async function getAllAnalyses(): Promise<StoredAnalysis[]> {
  return readAllAnalyses(getConfig().analysisDir);
}
