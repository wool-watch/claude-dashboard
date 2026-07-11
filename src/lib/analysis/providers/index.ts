import { AnalysisError } from "@/lib/analysis/errors";
import { PROVIDER_LABELS } from "@/lib/analysis/provider-labels";
import { runClaudeJson } from "@/lib/analysis/providers/claude";
import { runCodexJson } from "@/lib/analysis/providers/codex";
import { runGeminiJson } from "@/lib/analysis/providers/gemini";
import { runOpenAiCompatJson } from "@/lib/analysis/providers/openai-compat";
import type {
  ProviderRunOptions,
  ProviderRunOutcome,
} from "@/lib/analysis/providers/types";
import type { DashboardConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";

export { PROVIDER_LABELS } from "@/lib/analysis/provider-labels";

/** アクティブプロバイダに設定されたモデル名を返す */
export function resolveProviderModel(settings: AppSettings): string {
  return settings.providers[settings.analysisProvider].model;
}

/**
 * settings.analysisProvider に応じて各アダプタへ委譲する統一エントリ。
 * options.model 省略時はアクティブプロバイダの設定モデルを使う。
 * result のスキーマ検証は行わない（呼出側の責務）。
 */
export async function runWithProvider(
  prompt: string,
  options: Omit<ProviderRunOptions, "model"> & { model?: string },
  settings: AppSettings,
  config: DashboardConfig,
): Promise<ProviderRunOutcome> {
  const provider = settings.analysisProvider;
  const model = options.model ?? settings.providers[provider].model;
  if (model === "") {
    throw new AnalysisError(
      `${PROVIDER_LABELS[provider]} のモデル名が設定されていません。設定画面で指定してください`,
      "cli-failed",
    );
  }
  const opts: ProviderRunOptions = {
    jsonSchema: options.jsonSchema,
    systemPrompt: options.systemPrompt,
    signal: options.signal,
    model,
  };
  switch (provider) {
    case "claude":
      return runClaudeJson(prompt, opts, config, settings.providers.claude.cliPath);
    case "codex":
      return runCodexJson(prompt, opts, config, settings.providers.codex.cliPath);
    case "gemini":
      return runGeminiJson(prompt, opts, config, settings.providers.gemini.cliPath);
    case "lmstudio":
      return runOpenAiCompatJson(prompt, opts, config, {
        baseUrl: settings.providers.lmstudio.baseUrl,
        displayName: PROVIDER_LABELS.lmstudio,
      });
    case "openaiCompatible": {
      const p = settings.providers.openaiCompatible;
      // 平文保存を避けたい場合は環境変数が settings より優先
      const apiKey = process.env.OPENAI_COMPAT_API_KEY ?? p.apiKey;
      return runOpenAiCompatJson(prompt, opts, config, {
        baseUrl: p.baseUrl,
        apiKey,
        displayName: PROVIDER_LABELS.openaiCompatible,
      });
    }
  }
}
