import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StoredAnalysis } from "@/lib/analysis/types";
import { isStoredAnalysis } from "@/lib/analysis/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ANALYSIS_FILE_RE = /^[0-9a-f-]{36}\.json$/i;

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
