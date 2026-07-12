/** セッション取得元CLIの識別子 */
export const SESSION_SOURCE_IDS = ["claude", "codex", "gemini"] as const;

export type SessionSourceId = (typeof SESSION_SOURCE_IDS)[number];

export function isSessionSourceId(value: unknown): value is SessionSourceId {
  return (
    typeof value === "string" &&
    (SESSION_SOURCE_IDS as readonly string[]).includes(value)
  );
}

/** ソース表示名（UIバッジ・分析プロンプト用） */
export const SESSION_SOURCE_LABELS: Record<SessionSourceId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};
