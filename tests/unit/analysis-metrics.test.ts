import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cacheReadRatio,
  computeSessionMetrics,
  formatMetricsForPrompt,
  isSessionMetrics,
  linesPerActiveHour,
  TEST_COMMAND_RE,
  toolErrorRate,
  usdPer100Lines,
  type SessionMetrics,
} from "@/lib/analysis/metrics";
import { emptyUsage, type SessionSummary } from "@/lib/types";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );

const summaryOf = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: "s-metrics",
  projectId: "-home-test-proj-m",
  projectPath: "/home/test/proj-m",
  title: "テスト",
  firstAt: "2026-07-01T00:00:00.000Z",
  lastAt: "2026-07-01T00:01:20.000Z",
  turnCount: 3,
  messageCount: 10,
  sidechainMessageCount: 2,
  models: ["claude-opus-4-8"],
  usage: {
    ...emptyUsage(),
    inputTokens: 8_100,
    outputTokens: 2_000,
    cacheReadTokens: 3_000,
    cacheWrite5mTokens: 900,
  },
  costUSD: 0.5,
  costIsEstimated: false,
  activeTimeMs: 60_000,
  version: null,
  gitBranch: null,
  ...over,
});

describe("computeSessionMetrics", () => {
  const metrics = computeSessionMetrics(fixture("metrics-session.jsonl"), summaryOf());

  it("実装規模: 編集系 tool_use から件数・ファイル数・推定行数を算出（requestId 重複はデデュープ）", () => {
    expect(metrics.editOpCount).toBe(4); // Edit×2(a.ts) + Write(b.ts) + サイドチェーン Edit(side.ts)
    expect(metrics.editedFileCount).toBe(3);
    expect(metrics.estimatedLinesAdded).toBe(12); // 3 + 2 + 5 + 2
    expect(metrics.estimatedLinesRemoved).toBe(4); // 2 + 1 + 1
  });

  it("手戻りシグナル: 割り込み回数（isMeta 除外）と再編集ファイル数", () => {
    expect(metrics.interruptionCount).toBe(2); // 2変種、isMeta の1件は除外
    expect(metrics.reEditedFileCount).toBe(1); // src/a.ts のみ2回
    expect(metrics.maxEditsPerFile).toBe(2);
  });

  it("不具合シグナル: tool_result のエラー率とテスト実行・失敗回数", () => {
    expect(metrics.toolResultCount).toBe(7);
    expect(metrics.toolErrorCount).toBe(1);
    expect(metrics.testRunCount).toBe(2); // npm run test ×2（ls は対象外）
    expect(metrics.testFailCount).toBe(1);
  });

  it("時間・コスト・トークンは SessionSummary から転記する", () => {
    expect(metrics.durationMs).toBe(80_000); // lastAt - firstAt
    expect(metrics.activeTimeMs).toBe(60_000);
    expect(metrics.costUSD).toBe(0.5);
    expect(metrics.inputTokens).toBe(8_100);
    expect(metrics.cacheReadTokens).toBe(3_000);
    expect(metrics.totalTokens).toBe(14_000); // 8100+2000+900+0+3000
    expect(metrics.sidechainMessageCount).toBe(2);
    expect(metrics.turnCount).toBe(3);
  });

  it("空セッションは全項目ゼロ", () => {
    const empty = computeSessionMetrics(
      "",
      summaryOf({
        firstAt: "",
        lastAt: "",
        turnCount: 0,
        sidechainMessageCount: 0,
        usage: emptyUsage(),
        costUSD: 0,
        activeTimeMs: 0,
      }),
    );
    expect(empty.editOpCount).toBe(0);
    expect(empty.editedFileCount).toBe(0);
    expect(empty.estimatedLinesAdded).toBe(0);
    expect(empty.interruptionCount).toBe(0);
    expect(empty.toolResultCount).toBe(0);
    expect(empty.testRunCount).toBe(0);
    expect(empty.durationMs).toBe(0); // 不正な日時は 0 に丸める
    expect(empty.totalTokens).toBe(0);
  });

  it("MultiEdit / NotebookEdit も防御的に集計する", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        requestId: "rm1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_m1",
              name: "MultiEdit",
              input: {
                file_path: "src/m.ts",
                edits: [
                  { old_string: "a", new_string: "a\nb" },
                  { old_string: "c\nd", new_string: "e" },
                ],
              },
            },
            {
              type: "tool_use",
              id: "toolu_n1",
              name: "NotebookEdit",
              input: { notebook_path: "nb.ipynb", new_source: "x\ny\nz" },
            },
          ],
        },
        uuid: "m1",
        timestamp: "2026-07-01T00:00:00.000Z",
        sessionId: "s",
        isSidechain: false,
      }),
    ].join("\n");
    const m = computeSessionMetrics(jsonl, summaryOf());
    expect(m.editOpCount).toBe(2);
    expect(m.editedFileCount).toBe(2); // src/m.ts と nb.ipynb
    expect(m.estimatedLinesAdded).toBe(2 + 1 + 3); // a\nb, e, x\ny\nz
    expect(m.estimatedLinesRemoved).toBe(1 + 2); // a, c\nd
  });
});

describe("TEST_COMMAND_RE", () => {
  it("テストコマンドのみマッチする", () => {
    for (const cmd of [
      "npm run test -- --run",
      "npm test",
      "npx vitest run tests/unit",
      "pnpm test",
      "yarn test",
      "pytest -q",
      "go test ./...",
      "cargo test",
      "jest --ci",
      "npx playwright test",
    ]) {
      expect(cmd).toMatch(TEST_COMMAND_RE);
    }
    for (const cmd of ["ls -la", "npm run build", "git status", "attest --run"]) {
      expect(cmd).not.toMatch(TEST_COMMAND_RE);
    }
  });
});

describe("派生指標", () => {
  const base: SessionMetrics = {
    editedFileCount: 3,
    editOpCount: 4,
    estimatedLinesAdded: 120,
    estimatedLinesRemoved: 80,
    interruptionCount: 1,
    reEditedFileCount: 1,
    maxEditsPerFile: 2,
    toolResultCount: 8,
    toolErrorCount: 2,
    testRunCount: 2,
    testFailCount: 1,
    durationMs: 3_600_000,
    activeTimeMs: 1_800_000,
    costUSD: 2,
    totalTokens: 100_000,
    inputTokens: 10_000,
    cacheReadTokens: 40_000,
    sidechainMessageCount: 0,
    turnCount: 5,
  };

  it("toolErrorRate: エラー数 / tool_result 数（0件は null）", () => {
    expect(toolErrorRate(base)).toBeCloseTo(0.25);
    expect(toolErrorRate({ ...base, toolResultCount: 0, toolErrorCount: 0 })).toBeNull();
  });

  it("cacheReadRatio: cacheRead / (input + cacheRead)（0は null）", () => {
    expect(cacheReadRatio(base)).toBeCloseTo(0.8);
    expect(cacheReadRatio({ ...base, inputTokens: 0, cacheReadTokens: 0 })).toBeNull();
  });

  it("linesPerActiveHour: 推定変更行数 / アクティブ時間(h)（0ms は null）", () => {
    expect(linesPerActiveHour(base)).toBeCloseTo(400); // 200行 / 0.5h
    expect(linesPerActiveHour({ ...base, activeTimeMs: 0 })).toBeNull();
  });

  it("usdPer100Lines: コスト / (変更行数/100)（0行は null）", () => {
    expect(usdPer100Lines(base)).toBeCloseTo(1); // $2 / 2
    expect(
      usdPer100Lines({ ...base, estimatedLinesAdded: 0, estimatedLinesRemoved: 0 }),
    ).toBeNull();
  });

  it("isSessionMetrics: 全キーが 0 以上の有限数のときのみ true", () => {
    expect(isSessionMetrics(base)).toBe(true);
    expect(isSessionMetrics({ ...base, editOpCount: -1 })).toBe(false);
    expect(isSessionMetrics({ ...base, costUSD: Number.NaN })).toBe(false);
    const { turnCount: _omit, ...missing } = base;
    expect(isSessionMetrics(missing)).toBe(false);
    expect(isSessionMetrics(null)).toBe(false);
  });
});

describe("formatMetricsForPrompt", () => {
  it("主要指標を日本語の箇条書きで含む", () => {
    const m: SessionMetrics = {
      editedFileCount: 3,
      editOpCount: 4,
      estimatedLinesAdded: 120,
      estimatedLinesRemoved: 80,
      interruptionCount: 2,
      reEditedFileCount: 1,
      maxEditsPerFile: 2,
      toolResultCount: 8,
      toolErrorCount: 2,
      testRunCount: 2,
      testFailCount: 1,
      durationMs: 3_600_000,
      activeTimeMs: 1_800_000,
      costUSD: 2.5,
      totalTokens: 100_000,
      inputTokens: 10_000,
      cacheReadTokens: 40_000,
      sidechainMessageCount: 3,
      turnCount: 5,
    };
    const text = formatMetricsForPrompt(m);
    expect(text).toContain("推定変更行数: +120 / -80");
    expect(text).toContain("編集ファイル数: 3");
    expect(text).toContain("再編集ファイル数: 1");
    expect(text).toContain("ユーザー割り込み: 2回");
    expect(text).toContain("ツールエラー: 2/8");
    expect(text).toContain("テスト実行: 2回（失敗 1回）");
    expect(text).toContain("$2.50");
    expect(text).toContain("キャッシュ読取比率: 80%");
  });
});
