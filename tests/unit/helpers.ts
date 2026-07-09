import {
  addUsage,
  emptyUsage,
  type SessionDetail,
  type Turn,
  type UsageTotals,
} from "@/lib/types";

export const usageOf = (input: number, output = 0): UsageTotals => ({
  ...emptyUsage(),
  inputTokens: input,
  outputTokens: output,
});

export function mkTurn(startedAt: string, over: Partial<Turn> = {}): Turn {
  const usage = over.usage ?? usageOf(1000);
  return {
    promptId: "p",
    userText: "質問",
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    activeTimeMs: 60_000,
    models: ["claude-opus-4-8"],
    perModelUsage: { "claude-opus-4-8": usage },
    perModelRequests: { "claude-opus-4-8": 1 },
    toolCounts: {},
    usage,
    costUSD: 0.01,
    costIsEstimated: false,
    assistantMessageCount: 2,
    hasSidechain: false,
    ...over,
  };
}

export function mkSession(
  sessionId: string,
  turns: Turn[],
  over: Partial<SessionDetail> = {},
): SessionDetail {
  let usage = emptyUsage();
  let costUSD = 0;
  for (const t of turns) {
    usage = addUsage(usage, t.usage);
    costUSD += t.costUSD;
  }
  return {
    sessionId,
    projectId: "-proj",
    projectPath: "/home/test/proj",
    title: "テストセッション",
    firstAt: turns[0]?.startedAt ?? "",
    lastAt: turns[turns.length - 1]?.startedAt ?? "",
    turnCount: turns.length,
    messageCount: turns.length * 3,
    sidechainMessageCount: 0,
    models: ["claude-opus-4-8"],
    usage,
    costUSD,
    costIsEstimated: false,
    activeTimeMs: turns.reduce((a, t) => a + t.activeTimeMs, 0),
    version: null,
    gitBranch: null,
    turns,
    skippedLines: 0,
    ...over,
  };
}
