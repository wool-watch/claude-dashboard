import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import { isStoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import type { StoredQueue } from "@/lib/analysis/queue-types";
import { isStoredQueue } from "@/lib/analysis/queue-types";
import type { StoredAnalysis } from "@/lib/analysis/types";
import { isStoredAnalysis } from "@/lib/analysis/types";

export const UUID_RE = /^[0-9a-f-]{36}$/i;
const ANALYSIS_FILE_RE = /^[0-9a-f-]{36}\.json$/i;
/**
 * projectId（~/.claude/projects 直下のディレクトリ名）として妥当な形式。
 * クエリ等の外部入力をファイル名に使うため、パス区切りを含むものは拒否する。
 */
export const PROJECT_ID_RE = /^[A-Za-z0-9._-]+$/;
/** 優先課題分析の保存先（1件のみ・UUID名でないため readAllAnalyses には拾われない） */
const PRIORITY_FILE_NAME = "priority-analysis.json";

/** 優先課題分析の保存ファイル名（projectId 指定でプロジェクト別・不正な形式は null） */
function priorityFileNameFor(projectId?: string): string | null {
  if (projectId === undefined) return PRIORITY_FILE_NAME;
  if (!PROJECT_ID_RE.test(projectId)) return null;
  return `priority-analysis.${projectId}.json`;
}
/** 分析キューの保存先（UUID名でないため readAllAnalyses には拾われない） */
const QUEUE_FILE_NAME = "analysis-queue.json";

/** tmp に書いて rename するアトミック書き込み */
async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

/** tmp に書いて rename するアトミック書き込み */
export async function writeAnalysis(
  analysisDir: string,
  analysis: StoredAnalysis,
): Promise<void> {
  await writeJsonAtomic(
    path.join(analysisDir, `${analysis.sessionId}.json`),
    analysis,
  );
}

/** 欠損・破損・型ガード不合格は null（起動を止めない） */
export async function readAnalysis(
  analysisDir: string,
  sessionId: string,
): Promise<StoredAnalysis | null> {
  if (!UUID_RE.test(sessionId)) return null;
  let text: string;
  try {
    text = await fs.readFile(path.join(analysisDir, `${sessionId}.json`), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isStoredAnalysis(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** tmp に書いて rename するアトミック書き込み（常に上書き・1件のみ） */
export async function writePriorityAnalysis(
  analysisDir: string,
  analysis: StoredPriorityAnalysis,
  projectId?: string,
): Promise<void> {
  const fileName = priorityFileNameFor(projectId);
  if (fileName === null) {
    throw new Error(`projectId の形式が不正です: ${projectId}`);
  }
  await writeJsonAtomic(path.join(analysisDir, fileName), analysis);
}

/** 欠損・破損・型ガード不合格は null（起動を止めない） */
export async function readPriorityAnalysis(
  analysisDir: string,
  projectId?: string,
): Promise<StoredPriorityAnalysis | null> {
  const fileName = priorityFileNameFor(projectId);
  if (fileName === null) return null;
  let text: string;
  try {
    text = await fs.readFile(path.join(analysisDir, fileName), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isStoredPriorityAnalysis(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 保存済み分析を全件読む。不正ファイルはスキップ */
export async function readAllAnalyses(
  analysisDir: string,
): Promise<StoredAnalysis[]> {
  let files: string[];
  try {
    files = await fs.readdir(analysisDir);
  } catch {
    return []; // 未作成
  }
  const out: StoredAnalysis[] = [];
  for (const file of files) {
    if (!ANALYSIS_FILE_RE.test(file)) continue;
    const analysis = await readAnalysis(analysisDir, file.replace(/\.json$/i, ""));
    if (analysis !== null) out.push(analysis);
  }
  return out;
}

export async function writeQueue(
  analysisDir: string,
  queue: StoredQueue,
): Promise<void> {
  await writeJsonAtomic(path.join(analysisDir, QUEUE_FILE_NAME), queue);
}

/** 欠損・破損・型ガード不合格は EMPTY_QUEUE 扱い（起動を止めない） */
export async function readQueue(analysisDir: string): Promise<StoredQueue> {
  const empty = (): StoredQueue => ({
    schemaVersion: 1,
    paused: false,
    items: [],
  });
  let text: string;
  try {
    text = await fs.readFile(path.join(analysisDir, QUEUE_FILE_NAME), "utf8");
  } catch {
    return empty();
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isStoredQueue(parsed) ? parsed : empty();
  } catch {
    return empty();
  }
}
