import type { ProviderId } from "@/lib/settings/settings";

/**
 * プロバイダの表示名。UI・エラーメッセージ共通。
 * Node API を import しない（クライアントコンポーネントからも参照するため）。
 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  lmstudio: "LM Studio",
  openaiCompatible: "OpenAI互換API",
};
