// TZ=Asia/Tokyo で実行される前提
import { describe, expect, it } from "vitest";
import { aggregateModels } from "@/lib/aggregate/models";
import { aggregateProjects } from "@/lib/aggregate/projects";
import { buildSummary } from "@/lib/aggregate/summary";
import { aggregateTools } from "@/lib/aggregate/tools";
import { mkSession, mkTurn, usageOf } from "./helpers";

describe("aggregateModels", () => {
  const sessions = [
    mkSession("s1", [
      mkTurn("2026-07-05T01:00:00.000Z", {
        models: ["claude-opus-4-8", "claude-sonnet-4-6"],
        perModelUsage: {
          "claude-opus-4-8": usageOf(1_000_000), // $5
          "claude-sonnet-4-6": usageOf(1_000_000), // $3
        },
        perModelRequests: { "claude-opus-4-8": 2, "claude-sonnet-4-6": 1 },
      }),
      mkTurn("2026-07-05T02:00:00.000Z", {
        models: ["claude-opus-4-8"],
        perModelUsage: { "claude-opus-4-8": usageOf(1_000_000) },
        perModelRequests: { "claude-opus-4-8": 1 },
      }),
    ]),
    mkSession("s2", [
      mkTurn("2026-07-05T03:00:00.000Z", {
        models: ["claude-test-99"],
        perModelUsage: { "claude-test-99": usageOf(1_000_000) },
        perModelRequests: { "claude-test-99": 3 },
      }),
    ]),
  ];

  it("モデル別に usage / リクエスト数を合算し cost 降順で返す", () => {
    const stats = aggregateModels(sessions, {});
    expect(stats.map((m) => m.model)).toEqual([
      "claude-opus-4-8", // $10
      "claude-test-99", // $5（フォールバック）
      "claude-sonnet-4-6", // $3
    ]);
    expect(stats[0].usage.inputTokens).toBe(2_000_000);
    expect(stats[0].requestCount).toBe(3);
    expect(stats[0].costUSD).toBeCloseTo(10, 6);
    expect(stats[0].isEstimated).toBe(false);
  });

  it("未知モデルは isEstimated=true", () => {
    const stats = aggregateModels(sessions, {});
    const unknown = stats.find((m) => m.model === "claude-test-99");
    expect(unknown?.isEstimated).toBe(true);
  });

  it("期間フィルタが効く", () => {
    const stats = aggregateModels(sessions, {
      from: new Date("2026-07-05T02:30:00.000Z"),
    });
    expect(stats.map((m) => m.model)).toEqual(["claude-test-99"]);
  });
});

describe("aggregateTools", () => {
  it("ツール名別に合算し回数降順で返す（mcp__ 名も対応）", () => {
    const sessions = [
      mkSession("s1", [
        mkTurn("2026-07-05T01:00:00.000Z", {
          toolCounts: { Read: 2, Bash: 1, mcp__serena__find_symbol: 1 },
        }),
        mkTurn("2026-07-05T02:00:00.000Z", { toolCounts: { Read: 1 } }),
      ]),
    ];
    expect(aggregateTools(sessions, {})).toEqual([
      { tool: "Read", count: 3 },
      { tool: "Bash", count: 1 },
      { tool: "mcp__serena__find_symbol", count: 1 },
    ]);
  });

  it("project フィルタが効く", () => {
    const a = mkSession(
      "s1",
      [mkTurn("2026-07-05T01:00:00.000Z", { toolCounts: { Read: 1 } })],
      { projectId: "-a" },
    );
    const b = mkSession(
      "s2",
      [mkTurn("2026-07-05T01:00:00.000Z", { toolCounts: { Bash: 5 } })],
      { projectId: "-b" },
    );
    expect(aggregateTools([a, b], { projectId: "-a" })).toEqual([
      { tool: "Read", count: 1 },
    ]);
  });
});

describe("aggregateProjects", () => {
  it("プロジェクト別に集計し lastAt 降順で返す", () => {
    const a1 = mkSession("s1", [mkTurn("2026-07-01T00:00:00.000Z")], {
      projectId: "-proj-a",
      projectPath: "/home/test/proj-a",
      lastAt: "2026-07-01T00:00:00.000Z",
      costUSD: 1,
    });
    const a2 = mkSession("s2", [mkTurn("2026-07-05T00:00:00.000Z")], {
      projectId: "-proj-a",
      projectPath: "/home/test/proj-a",
      lastAt: "2026-07-05T00:00:00.000Z",
      costUSD: 2,
    });
    const b = mkSession("s3", [mkTurn("2026-07-03T00:00:00.000Z")], {
      projectId: "-proj-b",
      projectPath: "/home/test/proj-b",
      lastAt: "2026-07-03T00:00:00.000Z",
      costUSD: 4,
    });
    const projects = aggregateProjects([a1, a2, b]);
    expect(projects.map((p) => p.projectId)).toEqual(["-proj-a", "-proj-b"]);
    const pa = projects[0];
    expect(pa.sessionCount).toBe(2);
    expect(pa.turnCount).toBe(2);
    expect(pa.costUSD).toBeCloseTo(3, 9);
    expect(pa.displayName).toBe("proj-a");
    expect(pa.lastAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("cwd が取れずディレクトリ名のままでも displayName が壊れない", () => {
    const s = mkSession("s1", [mkTurn("2026-07-01T00:00:00.000Z")], {
      projectId: "-encoded-name",
      projectPath: "-encoded-name",
    });
    expect(aggregateProjects([s])[0].displayName).toBe("-encoded-name");
  });
});

describe("buildSummary", () => {
  // now = JST 2026-07-09(木) 12:00。今週 = 7/6(月)〜、今月 = 7/1〜
  const now = new Date(2026, 6, 9, 12, 0);
  const sessions = [
    mkSession("s-today", [
      mkTurn("2026-07-09T01:00:00.000Z", { costUSD: 1, activeTimeMs: 1000 }), // JST 今日 10:00
    ]),
    mkSession("s-week", [
      mkTurn("2026-07-07T00:00:00.000Z", { costUSD: 2, activeTimeMs: 2000 }), // JST 7/7
    ]),
    mkSession("s-month", [
      mkTurn("2026-07-02T00:00:00.000Z", { costUSD: 4, activeTimeMs: 4000 }), // JST 7/2
    ]),
    mkSession("s-old", [
      mkTurn("2026-06-01T00:00:00.000Z", { costUSD: 8, activeTimeMs: 8000 }), // 先月
    ]),
  ];
  const summary = buildSummary(sessions, now);

  it("totals は全期間", () => {
    expect(summary.totals.turnCount).toBe(4);
    expect(summary.totals.costUSD).toBeCloseTo(15, 9);
    expect(summary.totals.sessionCount).toBe(4);
    expect(summary.totals.activeTimeMs).toBe(15_000);
    expect(summary.totals.totalTokens).toBe(4000); // mkTurn 既定 input 1000 ×4
  });

  it("today / thisWeek / thisMonth の小計（JST・週=月曜開始）", () => {
    expect(summary.today.turnCount).toBe(1);
    expect(summary.today.costUSD).toBeCloseTo(1, 9);
    expect(summary.thisWeek.turnCount).toBe(2);
    expect(summary.thisWeek.costUSD).toBeCloseTo(3, 9);
    expect(summary.thisMonth.turnCount).toBe(3);
    expect(summary.thisMonth.costUSD).toBeCloseTo(7, 9);
  });

  it("costIsEstimated はいずれかのセッションが推定なら true", () => {
    expect(summary.costIsEstimated).toBe(false);
    const withEstimated = [
      ...sessions,
      mkSession("s-est", [mkTurn("2026-07-09T02:00:00.000Z")], {
        costIsEstimated: true,
      }),
    ];
    expect(buildSummary(withEstimated, now).costIsEstimated).toBe(true);
  });

  it("空データでもクラッシュしない", () => {
    const empty = buildSummary([], now);
    expect(empty.totals.costUSD).toBe(0);
    expect(empty.today.sessionCount).toBe(0);
  });
});
