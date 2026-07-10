import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { RunOutcome } from "@/lib/analysis/runner";
import { AnalysisError, runClaudeAnalysis } from "@/lib/analysis/runner";
import {
  readAllAnalyses,
  readAnalysis,
  readQueue,
  writeAnalysis,
} from "@/lib/analysis/store";
import { buildTranscript } from "@/lib/analysis/transcript";
import type { SessionAnalysisStatus, StoredAnalysis } from "@/lib/analysis/types";
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
  signal?: AbortSignal,
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
  opts: { signal?: AbortSignal } = {},
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
      opts.signal,
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

/** 指定セッションの分析が実行中か */
export function isAnalysisInflight(sessionId: string): boolean {
  return getInflightMap().has(sessionId);
}

/** 実行中の分析セッションID一覧 */
export function getInflightSessionIds(): string[] {
  return [...getInflightMap().keys()];
}

/**
 * 保存済み分析1件の鮮度を判定する。
 * StoredAnalysis の projectId から直接パスを組み立てて stat するので、
 * セッション総数に依存せず分析件数分の I/O で済む（live → archive の順に解決）。
 */
async function statusOfAnalysis(
  analysis: StoredAnalysis,
  config: DashboardConfig,
): Promise<SessionAnalysisStatus> {
  for (const rootDir of [config.dataDir, config.archiveDir]) {
    const filePath = path.join(
      rootDir,
      analysis.projectId,
      `${analysis.sessionId}.jsonl`,
    );
    try {
      const st = await stat(filePath);
      const changed =
        Math.abs(st.mtimeMs - analysis.sourceMtimeMs) >= 2 ||
        st.size !== analysis.sourceSize;
      return changed ? "stale" : "analyzed";
    } catch {
      // このルートには無い
    }
  }
  return "stale"; // セッションファイル消滅
}

/**
 * セッション一覧用: sessionId → 分析ステータスの Map。
 * 実行中（in-flight）は保存済み分析の有無にかかわらず "analyzing" を優先する。
 * Map に無いセッションは未分析（"none"）として扱う。
 */
export async function getAnalysisStatusMap(): Promise<
  Map<string, SessionAnalysisStatus>
> {
  const config = getConfig();
  const [analyses, queue] = await Promise.all([
    readAllAnalyses(config.analysisDir),
    readQueue(config.analysisDir),
  ]);
  const entries = await Promise.all(
    analyses.map(
      async (a) => [a.sessionId, await statusOfAnalysis(a, config)] as const,
    ),
  );
  const map = new Map<string, SessionAnalysisStatus>(entries);
  // 待機中は分析済み・stale より優先（一覧の関心事は「これから何が起きるか」）
  for (const item of queue.items) {
    if (item.state === "pending") map.set(item.sessionId, "queued");
    else if (item.state === "running") map.set(item.sessionId, "analyzing");
  }
  for (const sessionId of getInflightMap().keys()) {
    map.set(sessionId, "analyzing");
  }
  return map;
}
