import { stat } from "node:fs/promises";
import path from "node:path";
import { runWithProvider } from "@/lib/analysis/providers";
import type { ProviderRunOutcome } from "@/lib/analysis/providers/types";
import {
  AnalysisError,
  SESSION_ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/analysis/runner";
import {
  computeSessionMetrics,
  formatMetricsForPrompt,
  type SessionMetrics,
} from "@/lib/analysis/metrics";
import {
  isLegacyAnalysisFile,
  readAllAnalyses,
  readAnalysis,
  readLegacyAnalysisRefs,
  readQueue,
  writeAnalysis,
} from "@/lib/analysis/store";
import { buildTranscript } from "@/lib/analysis/transcript";
import type { SessionAnalysisStatus, StoredAnalysis } from "@/lib/analysis/types";
import { ANALYSIS_JSON_SCHEMA, isAnalysisResult } from "@/lib/analysis/types";
import type { DashboardConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";
import { readSettings } from "@/lib/settings/settings";
import { formatSessionKey } from "@/lib/sources/keys";
import { loadSessionRecords } from "@/lib/sources/load";
import { SESSION_SOURCE_LABELS } from "@/lib/sources/types";
import { getSession, getSessionFileRef } from "@/lib/store/repository";

export interface AnalysisWithStaleness {
  analysis: StoredAnalysis | null;
  isStale: boolean;
}

type RunFn = (
  prompt: string,
  options: {
    model: string;
    jsonSchema: object;
    systemPrompt: string;
    signal?: AbortSignal;
  },
  settings: AppSettings,
  config: DashboardConfig,
) => Promise<ProviderRunOutcome>;

declare global {
  // Next.js dev の HMR でモジュールが再評価されても実行中の分析を追跡し続ける
  var __claudeDashboardAnalysisInflight: Map<string, Promise<unknown>> | undefined;
}

function getInflightMap(): Map<string, Promise<unknown>> {
  globalThis.__claudeDashboardAnalysisInflight ??= new Map();
  return globalThis.__claudeDashboardAnalysisInflight;
}

function buildPrompt(
  transcript: string,
  metrics: SessionMetrics,
  sourceLabel: string,
): string {
  return `以下は ${sourceLabel} のセッション（ユーザーとアシスタントのやり取り）の記録と、記録から機械的に算出した定量メトリクスです。
[USER] がユーザーの指示、[ASSISTANT] がアシスタントの応答（使用ツール付き）です。

この記録を分析し、次の観点で振り返りを出力してください:
- summary: セッション全体で何をしようとし、どう進んだか、品質・工数・コストの面でどうだったかの要約（2〜3文）
- goodPoints: ユーザーの指示・進め方で効果的だった点（具体的な発言・数値を根拠に）
- improvements: 品質・作業時間・コストを改善するための具体アクション。action は次のセッション冒頭でそのまま実行できる一文で書くこと（例: 「着手前に対象ファイル一覧と完了条件を提示させる」）。category は手戻り・非効率の主因を選ぶこと
- scores: ハーネス実践の5軸を1〜5の整数で
  - planning: 着手前に計画・完了条件・タスク分解があったか
  - contextProvision: 背景・制約・成功基準を事前に共有したか
  - verification: 実装をテスト・動作確認で裏付けたか（完了宣言だけで終わっていないか）。テスト実行${metrics.testRunCount}回・失敗${metrics.testFailCount}回を必ず考慮すること
  - trajectoryStability: 手戻り・軌道修正の少なさ。ユーザー割り込み${metrics.interruptionCount}回・再編集${metrics.reEditedFileCount}ファイルを必ず考慮すること
  - scopeDiscipline: 対象範囲が明確で、途中で膨張しなかったか

注意:
- 評価は必ず記録中の発言と定量メトリクスの数値を根拠にし、一般論を避けること
- 推定変更行数はヒューリスティックであり、Write（新規作成）はファイル全量を計上するため大きめに出る
- 記録が途中で省略されている場合（「（中略）」「（省略）」マーカー）は、見えている範囲で判断すること

=== 定量メトリクス（ログから機械的に算出。評価の根拠に使うこと） ===
${formatMetricsForPrompt(metrics)}

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
  deps: { run: RunFn } = { run: runWithProvider },
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

    const { records } = loadSessionRecords(ref.filePath, session.source);
    const transcript = buildTranscript(records, config);
    if (transcript.userTurnCount === 0) {
      throw new AnalysisError(
        "分析対象の会話がありません（本線のユーザー発話が0件）",
        "no-conversation",
      );
    }

    const metrics = computeSessionMetrics(records, session);
    const settings = await readSettings(config.settingsPath);
    const provider = settings.analysisProvider;
    const model = settings.providers[provider].model;
    const outcome = await deps.run(
      buildPrompt(transcript.text, metrics, SESSION_SOURCE_LABELS[session.source]),
      {
        model,
        jsonSchema: ANALYSIS_JSON_SCHEMA,
        systemPrompt: SESSION_ANALYSIS_SYSTEM_PROMPT,
        signal: opts.signal,
      },
      settings,
      config,
    );
    if (!isAnalysisResult(outcome.result)) {
      throw new AnalysisError(
        "分析結果が期待する形式ではありません",
        "invalid-output",
      );
    }

    const stored: StoredAnalysis = {
      schemaVersion: 3,
      sessionId: session.sessionId,
      source: session.source,
      projectId: ref.projectId,
      analyzedAt: new Date().toISOString(),
      model,
      provider,
      sourceMtimeMs: ref.mtimeMs,
      sourceSize: ref.size,
      sessionLastAt: session.lastAt,
      costUSD: outcome.costUSD,
      metrics,
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
    // 旧 v1 形式は「要再分析」として stale 扱いで返す
    if (await isLegacyAnalysisFile(config.analysisDir, sessionId)) {
      return { analysis: null, isStale: true };
    }
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
  const source = analysis.source ?? "claude";
  if (source !== "claude") {
    // Codex/Gemini はパス直撃で解決できないため repository のインデックスを引く
    const ref = await getSessionFileRef(
      formatSessionKey(source, analysis.sessionId),
    );
    if (ref === null) return "stale"; // セッションファイル消滅
    const changed =
      Math.abs(ref.mtimeMs - analysis.sourceMtimeMs) >= 2 ||
      ref.size !== analysis.sourceSize;
    return changed ? "stale" : "analyzed";
  }
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
  const [analyses, legacyRefs, queue] = await Promise.all([
    readAllAnalyses(config.analysisDir),
    readLegacyAnalysisRefs(config.analysisDir),
    readQueue(config.analysisDir),
  ]);
  const entries = await Promise.all(
    analyses.map(
      async (a) =>
        [
          formatSessionKey(a.source ?? "claude", a.sessionId),
          await statusOfAnalysis(a, config),
        ] as const,
    ),
  );
  const map = new Map<string, SessionAnalysisStatus>(entries);
  // 旧 v1 形式は無条件で「要再分析」（一括再分析導線に乗せる）
  for (const legacy of legacyRefs) {
    if (!map.has(legacy.sessionId)) map.set(legacy.sessionId, "stale");
  }
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
