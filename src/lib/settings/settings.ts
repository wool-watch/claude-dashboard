import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiQueryError } from "@/lib/api/query";

/** アーカイブ保持日数。null は無制限（削除しない） */
export type RetentionDays = 30 | 90 | 120 | 150 | 180 | null;

/** セッション分析に使う Claude Code CLI のモデル */
export type AnalysisModel = "haiku" | "sonnet";

/** 分析に使うAIバックエンド */
export type ProviderId =
  | "claude"
  | "codex"
  | "gemini"
  | "lmstudio"
  | "openaiCompatible";

export interface ClaudeProviderSettings {
  model: AnalysisModel;
  /** 空文字は既定のコマンド（CLAUDE_CLI_PATH / "claude"）を使う */
  cliPath: string;
}

export interface CliProviderSettings {
  model: string;
  cliPath: string;
}

export interface LmStudioProviderSettings {
  model: string;
  baseUrl: string;
}

export interface OpenAiCompatProviderSettings {
  model: string;
  baseUrl: string;
  /** 空文字はキー未設定（Authorization ヘッダを付けない） */
  apiKey: string;
}

export interface ProviderSettingsMap {
  claude: ClaudeProviderSettings;
  codex: CliProviderSettings;
  gemini: CliProviderSettings;
  lmstudio: LmStudioProviderSettings;
  openaiCompatible: OpenAiCompatProviderSettings;
}

export interface AppSettings {
  retentionDays: RetentionDays;
  analysisProvider: ProviderId;
  providers: ProviderSettingsMap;
}

/** GET /api/settings が返す公開形。apiKey は hasApiKey に変換する */
export interface PublicAppSettings {
  retentionDays: RetentionDays;
  analysisProvider: ProviderId;
  providers: Omit<ProviderSettingsMap, "openaiCompatible"> & {
    openaiCompatible: { model: string; baseUrl: string; hasApiKey: boolean };
  };
}

export const RETENTION_OPTIONS: readonly RetentionDays[] = [
  30, 90, 120, 150, 180, null,
];

export const ANALYSIS_MODEL_OPTIONS: readonly AnalysisModel[] = [
  "haiku",
  "sonnet",
];

export const PROVIDER_IDS: readonly ProviderId[] = [
  "claude",
  "codex",
  "gemini",
  "lmstudio",
  "openaiCompatible",
];

export const DEFAULT_SETTINGS: AppSettings = {
  retentionDays: null,
  analysisProvider: "claude",
  providers: {
    claude: { model: "haiku", cliPath: "" },
    codex: { model: "gpt-5-codex", cliPath: "codex" },
    gemini: { model: "gemini-2.5-flash", cliPath: "gemini" },
    lmstudio: { model: "", baseUrl: "http://localhost:1234/v1" },
    openaiCompatible: {
      model: "",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
    },
  },
};

export function parseRetentionDays(raw: unknown): RetentionDays {
  if (RETENTION_OPTIONS.includes(raw as RetentionDays)) {
    return raw as RetentionDays;
  }
  throw new ApiQueryError(`invalid retentionDays: ${String(raw)}`);
}

export function parseAnalysisModel(raw: unknown): AnalysisModel {
  if (ANALYSIS_MODEL_OPTIONS.includes(raw as AnalysisModel)) {
    return raw as AnalysisModel;
  }
  throw new ApiQueryError(`invalid analysisModel: ${String(raw)}`);
}

export function parseAnalysisProvider(raw: unknown): ProviderId {
  if (PROVIDER_IDS.includes(raw as ProviderId)) {
    return raw as ProviderId;
  }
  throw new ApiQueryError(`invalid analysisProvider: ${String(raw)}`);
}

function parseString(raw: unknown, label: string): string {
  if (typeof raw === "string") return raw;
  throw new ApiQueryError(`invalid ${label}: ${String(raw)}`);
}

function parseBaseUrl(raw: unknown, label: string): string {
  const s = parseString(raw, label);
  if (/^https?:\/\//.test(s)) return s;
  throw new ApiQueryError(`invalid ${label}: must start with http(s):// (${s})`);
}

/**
 * プロバイダ設定のフィールドごとの検証関数。
 * readSettings のフィールド単位フォールバックと PUT の検証で共有する。
 */
const PROVIDER_FIELD_PARSERS: {
  [P in ProviderId]: {
    [K in keyof ProviderSettingsMap[P]]: (
      raw: unknown,
    ) => ProviderSettingsMap[P][K];
  };
} = {
  claude: {
    model: parseAnalysisModel,
    cliPath: (raw) => parseString(raw, "providers.claude.cliPath"),
  },
  codex: {
    model: (raw) => parseString(raw, "providers.codex.model"),
    cliPath: (raw) => parseString(raw, "providers.codex.cliPath"),
  },
  gemini: {
    model: (raw) => parseString(raw, "providers.gemini.model"),
    cliPath: (raw) => parseString(raw, "providers.gemini.cliPath"),
  },
  lmstudio: {
    model: (raw) => parseString(raw, "providers.lmstudio.model"),
    baseUrl: (raw) => parseBaseUrl(raw, "providers.lmstudio.baseUrl"),
  },
  openaiCompatible: {
    model: (raw) => parseString(raw, "providers.openaiCompatible.model"),
    baseUrl: (raw) => parseBaseUrl(raw, "providers.openaiCompatible.baseUrl"),
    apiKey: (raw) => parseString(raw, "providers.openaiCompatible.apiKey"),
  },
};

/** 1プロバイダ分を検証。不正・欠損フィールドはデフォルトへフォールバック */
function normalizeProvider<P extends ProviderId>(
  id: P,
  raw: unknown,
): ProviderSettingsMap[P] {
  const out = { ...DEFAULT_SETTINGS.providers[id] };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  const parsers = PROVIDER_FIELD_PARSERS[id] as Record<
    string,
    (raw: unknown) => unknown
  >;
  for (const key of Object.keys(parsers)) {
    if (!(key in record)) continue;
    try {
      (out as Record<string, unknown>)[key] = parsers[key](record[key]);
    } catch {}
  }
  return out;
}

/** 不正・欠損はキー単位でデフォルトへフォールバックする（旧形式ファイルとの後方互換） */
function normalizeSettings(parsed: Record<string, unknown>): AppSettings {
  const out = structuredClone(DEFAULT_SETTINGS);
  try {
    out.retentionDays = parseRetentionDays(parsed.retentionDays);
  } catch {}
  try {
    out.analysisProvider = parseAnalysisProvider(parsed.analysisProvider);
  } catch {}
  const rawProviders =
    typeof parsed.providers === "object" && parsed.providers !== null
      ? (parsed.providers as Record<string, unknown>)
      : {};
  for (const id of PROVIDER_IDS) {
    out.providers[id] = normalizeProvider(id, rawProviders[id]) as never;
  }
  // 旧形式: トップレベル analysisModel を providers.claude.model へ移行
  // （providers.claude.model が明示されていればそちらを優先）
  const claudeRaw = rawProviders.claude;
  const hasNewClaudeModel =
    typeof claudeRaw === "object" &&
    claudeRaw !== null &&
    "model" in (claudeRaw as Record<string, unknown>);
  if (!hasNewClaudeModel && "analysisModel" in parsed) {
    try {
      out.providers.claude.model = parseAnalysisModel(parsed.analysisModel);
    } catch {}
  }
  return out;
}

/** 欠損・破損・不正値はデフォルトにフォールバックする（起動を止めない） */
export async function readSettings(settingsPath: string): Promise<AppSettings> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, "utf8");
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return structuredClone(DEFAULT_SETTINGS);
    }
    return normalizeSettings(parsed as Record<string, unknown>);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * tmp に書いて rename するアトミック書き込み（部分書き込みを露出させない）。
 * APIキーを含み得るため 0600 で作成する。
 */
export async function writeSettings(
  settingsPath: string,
  settings: AppSettings,
): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(tmpPath, settingsPath);
}

/** APIレスポンス用に apiKey を hasApiKey へ変換する（キー本体は外に出さない） */
export function toPublicSettings(settings: AppSettings): PublicAppSettings {
  const { apiKey, ...openaiRest } = settings.providers.openaiCompatible;
  return {
    retentionDays: settings.retentionDays,
    analysisProvider: settings.analysisProvider,
    providers: {
      claude: { ...settings.providers.claude },
      codex: { ...settings.providers.codex },
      gemini: { ...settings.providers.gemini },
      lmstudio: { ...settings.providers.lmstudio },
      openaiCompatible: { ...openaiRest, hasApiKey: apiKey !== "" },
    },
  };
}

/**
 * PUT /api/settings の providers パッチを検証して settings にマージする。
 * プロバイダ単位・フィールド単位の部分更新。未知キー・不正値は ApiQueryError。
 * openaiCompatible.apiKey のみ特殊: 空文字=変更なし / null=クリア / 非空=上書き。
 * @returns 1フィールドでも更新したら true
 */
export function applyProvidersPatch(
  settings: AppSettings,
  rawPatch: unknown,
): boolean {
  if (typeof rawPatch !== "object" || rawPatch === null) {
    throw new ApiQueryError("invalid providers patch");
  }
  let touched = false;
  for (const [id, rawProvider] of Object.entries(rawPatch)) {
    const providerId = parseAnalysisProvider(id);
    if (typeof rawProvider !== "object" || rawProvider === null) {
      throw new ApiQueryError(`invalid providers.${providerId} patch`);
    }
    const record = rawProvider as Record<string, unknown>;
    const parsers = PROVIDER_FIELD_PARSERS[providerId] as Record<
      string,
      (raw: unknown) => unknown
    >;
    const target = settings.providers[providerId] as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (!(key in parsers)) {
        throw new ApiQueryError(`unknown key providers.${providerId}.${key}`);
      }
      if (providerId === "openaiCompatible" && key === "apiKey") {
        if (value === null) {
          target[key] = "";
        } else if (parsers[key](value) !== "") {
          target[key] = value;
        }
        // 空文字は「変更なし」として受理する（フォーム再送信でキーが消えないように）
        touched = true;
        continue;
      }
      target[key] = parsers[key](value);
      touched = true;
    }
  }
  return touched;
}
