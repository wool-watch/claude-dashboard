import { describe, expect, it } from "vitest";
import type { ProjectSummary, UsageTotals } from "@/lib/types";
import {
  applyProjectView,
  DEFAULT_PROJECT_VIEW,
  filterProjects,
  type ProjectViewState,
  sortProjects,
} from "@/lib/view/projects-view";

const usage = (inputTokens: number): UsageTotals => ({
  inputTokens,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
});

const mk = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  projectId: "-Users-me-proj",
  projectPath: "/Users/me/proj",
  displayName: "proj",
  sessionCount: 1,
  turnCount: 1,
  usage: usage(0),
  costUSD: 0,
  activeTimeMs: 0,
  lastAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

const state = (over: Partial<ProjectViewState> = {}): ProjectViewState => ({
  ...DEFAULT_PROJECT_VIEW,
  ...over,
});

describe("filterProjects", () => {
  it("空クエリは全件を返す", () => {
    const items = [mk({ projectId: "a" }), mk({ projectId: "b" })];
    expect(filterProjects(items, state())).toHaveLength(2);
  });

  it("表示名・パス部分一致（大文字小文字を無視）で絞り込む", () => {
    const items = [
      mk({ projectId: "a", displayName: "dashboard", projectPath: "/Users/me/dashboard" }),
      mk({ projectId: "b", displayName: "api", projectPath: "/Users/me/api" }),
    ];
    expect(
      filterProjects(items, state({ query: "DASH" })).map((p) => p.projectId),
    ).toEqual(["a"]);
    expect(
      filterProjects(items, state({ query: "/me/api" })).map((p) => p.projectId),
    ).toEqual(["b"]);
  });
});

describe("sortProjects", () => {
  it("既定は lastAt 降順", () => {
    const items = [
      mk({ projectId: "old", lastAt: "2026-07-01T00:00:00.000Z" }),
      mk({ projectId: "new", lastAt: "2026-07-10T00:00:00.000Z" }),
    ];
    expect(sortProjects(items, "lastAt", "desc").map((p) => p.projectId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("name 昇順で並べ替える", () => {
    const items = [
      mk({ projectId: "b", displayName: "banana" }),
      mk({ projectId: "a", displayName: "apple" }),
    ];
    expect(sortProjects(items, "name", "asc").map((p) => p.projectId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("sessions 降順で並べ替える", () => {
    const items = [
      mk({ projectId: "few", sessionCount: 2 }),
      mk({ projectId: "many", sessionCount: 20 }),
    ];
    expect(sortProjects(items, "sessions", "desc").map((p) => p.projectId)).toEqual([
      "many",
      "few",
    ]);
  });

  it("tokens 降順で並べ替える", () => {
    const items = [
      mk({ projectId: "sm", usage: usage(100) }),
      mk({ projectId: "lg", usage: usage(9000) }),
    ];
    expect(sortProjects(items, "tokens", "desc").map((p) => p.projectId)).toEqual([
      "lg",
      "sm",
    ]);
  });

  it("元配列を破壊しない", () => {
    const items = [mk({ projectId: "a", costUSD: 1 }), mk({ projectId: "b", costUSD: 2 })];
    const copy = [...items];
    sortProjects(items, "cost", "desc");
    expect(items).toEqual(copy);
  });
});

describe("applyProjectView", () => {
  it("フィルタと並べ替えを合成する", () => {
    const items = [
      mk({ projectId: "a", displayName: "dash-web", costUSD: 3 }),
      mk({ projectId: "b", displayName: "dash-api", costUSD: 9 }),
      mk({ projectId: "c", displayName: "other", costUSD: 100 }),
    ];
    const out = applyProjectView(
      items,
      state({ query: "dash", sortKey: "cost", order: "desc" }),
    );
    expect(out.map((p) => p.projectId)).toEqual(["b", "a"]);
  });
});
