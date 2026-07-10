import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import { isStoredPriorityAnalysis } from "@/lib/analysis/priority-types";
import type { StoredAnalysis } from "@/lib/analysis/types";
import { isStoredAnalysis } from "@/lib/analysis/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ANALYSIS_FILE_RE = /^[0-9a-f-]{36}\.json$/i;
/** 優先課題分析の保存先（1件のみ・UUID名でないため readAllAnalyses には拾われない） */
const PRIORITY_FILE_NAME = "priority-analysis.json";

/** tmp に書いて rename するアトミック書き込み */
export async function writeAnalysis(
  analysisDir: string,
  analysis: StoredAnalysis,
): Promise<void> {
  await fs.mkdir(analysisDir, { recursive: true });
  const filePath = path.join(analysisDir, `${analysis.sessionId}.json`);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(analysis, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
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
): Promise<void> {
  await fs.mkdir(analysisDir, { recursive: true });
  const filePath = path.join(analysisDir, PRIORITY_FILE_NAME);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(analysis, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

/** 欠損・破損・型ガード不合格は null（起動を止めない） */
export async function readPriorityAnalysis(
  analysisDir: string,
): Promise<StoredPriorityAnalysis | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(analysisDir, PRIORITY_FILE_NAME), "utf8");
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
