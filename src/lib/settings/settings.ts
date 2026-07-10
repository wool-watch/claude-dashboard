import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiQueryError } from "@/lib/api/query";

/** アーカイブ保持日数。null は無制限（削除しない） */
export type RetentionDays = 30 | 90 | 120 | 150 | 180 | null;

export interface AppSettings {
  retentionDays: RetentionDays;
}

export const RETENTION_OPTIONS: readonly RetentionDays[] = [
  30, 90, 120, 150, 180, null,
];

export const DEFAULT_SETTINGS: AppSettings = { retentionDays: null };

export function parseRetentionDays(raw: unknown): RetentionDays {
  if (RETENTION_OPTIONS.includes(raw as RetentionDays)) {
    return raw as RetentionDays;
  }
  throw new ApiQueryError(`invalid retentionDays: ${String(raw)}`);
}

/** 欠損・破損・不正値はデフォルトにフォールバックする（起動を止めない） */
export async function readSettings(settingsPath: string): Promise<AppSettings> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, "utf8");
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      retentionDays: parseRetentionDays(
        (parsed as Record<string, unknown>).retentionDays,
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** tmp に書いて rename するアトミック書き込み（部分書き込みを露出させない） */
export async function writeSettings(
  settingsPath: string,
  settings: AppSettings,
): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
  await fs.rename(tmpPath, settingsPath);
}
