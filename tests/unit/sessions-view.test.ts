import { describe, expect, it } from "vitest";
import type { SessionAnalysisStatus } from "@/lib/analysis/types";
import type { SessionSourceId } from "@/lib/sources/types";
import type { SessionListItem, UsageTotals } from "@/lib/types";
import {
  applySessionView,
  DEFAULT_SESSION_VIEW,
  filterSessions,
  type SessionViewState,
  sortSessions,
} from "@/lib/view/sessions-view";

const usage = (inputTokens: number): UsageTotals => ({
  inputTokens,
  outputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
});

const mk = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  sessionId: "id",
  sessionKey: "id",
  source: "claude" as SessionSourceId,
  projectId: "-Users-me-proj",
  projectPath: "/Users/me/proj",
  title: "セッション",
  firstAt: "2026-07-01T00:00:00.000Z",
  lastAt: "2026-07-01T00:00:00.000Z",
  turnCount: 1,
  messageCount: 2,
  sidechainMessageCount: 0,
  models: ["claude-opus-4-8"],
  usage: usage(0),
  costUSD: 0,
  costIsEstimated: false,
  activeTimeMs: 0,
  version: null,
  gitBranch: null,
  analysisStatus: "none" as SessionAnalysisStatus,
  ...over,
});

const state = (over: Partial<SessionViewState> = {}): SessionViewState => ({
  ...DEFAULT_SESSION_VIEW,
  ...over,
});

describe("filterSessions", () => {
  it("空クエリは全件を返す", () => {
    const items = [mk({ sessionKey: "a" }), mk({ sessionKey: "b" })];
    expect(filterSessions(items, state())).toHaveLength(2);
  });

  it("タイトル部分一致（大文字小文字を無視）で絞り込む", () => {
    const items = [
      mk({ sessionKey: "a", title: "Auth リファクタ" }),
      mk({ sessionKey: "b", title: "ダッシュボード改修" }),
    ];
    const hit = filterSessions(items, state({ query: "auth" }));
    expect(hit.map((s) => s.sessionKey)).toEqual(["a"]);
  });

  it("プロジェクトパス・モデル名でも検索できる", () => {
    const items = [
      mk({ sessionKey: "a", title: null, projectPath: "/Users/me/dashboard" }),
      mk({ sessionKey: "b", title: null, models: ["claude-sonnet-5"] }),
    ];
    expect(
      filterSessions(items, state({ query: "dashboard" })).map((s) => s.sessionKey),
    ).toEqual(["a"]);
    expect(
      filterSessions(items, state({ query: "sonnet" })).map((s) => s.sessionKey),
    ).toEqual(["b"]);
  });

  it("source を集合で絞り込む（空集合は全件）", () => {
    const items = [
      mk({ sessionKey: "a", source: "claude" }),
      mk({ sessionKey: "b", source: "codex" }),
    ];
    expect(filterSessions(items, state())).toHaveLength(2);
    expect(
      filterSessions(items, state({ sources: new Set(["codex"]) })).map(
        (s) => s.sessionKey,
      ),
    ).toEqual(["b"]);
  });

  it("source は複数選択で OR 結合する", () => {
    const items = [
      mk({ sessionKey: "a", source: "claude" }),
      mk({ sessionKey: "b", source: "codex" }),
      mk({ sessionKey: "c", source: "gemini" }),
    ];
    expect(
      filterSessions(
        items,
        state({ sources: new Set(["claude", "gemini"]) }),
      ).map((s) => s.sessionKey),
    ).toEqual(["a", "c"]);
  });

  it("分析ステータスを集合で絞り込む（複数は OR）", () => {
    const items = [
      mk({ sessionKey: "a", analysisStatus: "analyzed" }),
      mk({ sessionKey: "b", analysisStatus: "none" }),
      mk({ sessionKey: "c", analysisStatus: "stale" }),
    ];
    expect(
      filterSessions(
        items,
        state({ statuses: new Set(["analyzed", "stale"]) }),
      ).map((s) => s.sessionKey),
    ).toEqual(["a", "c"]);
  });

  it("複数条件は AND で結合する", () => {
    const items = [
      mk({ sessionKey: "a", source: "codex", title: "検索対応" }),
      mk({ sessionKey: "b", source: "codex", title: "無関係" }),
      mk({ sessionKey: "c", source: "claude", title: "検索対応" }),
    ];
    expect(
      filterSessions(
        items,
        state({ sources: new Set(["codex"]), query: "検索" }),
      ).map((s) => s.sessionKey),
    ).toEqual(["a"]);
  });
});

describe("sortSessions", () => {
  it("既定は lastAt 降順", () => {
    const items = [
      mk({ sessionKey: "old", lastAt: "2026-07-01T00:00:00.000Z" }),
      mk({ sessionKey: "new", lastAt: "2026-07-10T00:00:00.000Z" }),
    ];
    expect(sortSessions(items, "lastAt", "desc").map((s) => s.sessionKey)).toEqual([
      "new",
      "old",
    ]);
  });

  it("cost 昇順で並べ替える", () => {
    const items = [
      mk({ sessionKey: "hi", costUSD: 5 }),
      mk({ sessionKey: "lo", costUSD: 1 }),
    ];
    expect(sortSessions(items, "cost", "asc").map((s) => s.sessionKey)).toEqual([
      "lo",
      "hi",
    ]);
  });

  it("tokens 降順で並べ替える", () => {
    const items = [
      mk({ sessionKey: "sm", usage: usage(100) }),
      mk({ sessionKey: "lg", usage: usage(9000) }),
    ];
    expect(sortSessions(items, "tokens", "desc").map((s) => s.sessionKey)).toEqual([
      "lg",
      "sm",
    ]);
  });

  it("title 昇順で並べ替える（null はフォールバック）", () => {
    const items = [
      mk({ sessionKey: "b", title: "びび" }),
      mk({ sessionKey: "a", title: "あああ" }),
    ];
    expect(sortSessions(items, "title", "asc").map((s) => s.sessionKey)).toEqual([
      "a",
      "b",
    ]);
  });

  it("元配列を破壊しない", () => {
    const items = [mk({ sessionKey: "a", costUSD: 1 }), mk({ sessionKey: "b", costUSD: 2 })];
    const copy = [...items];
    sortSessions(items, "cost", "desc");
    expect(items).toEqual(copy);
  });
});

describe("applySessionView", () => {
  it("フィルタと並べ替えを合成する", () => {
    const items = [
      mk({ sessionKey: "a", source: "codex", costUSD: 3 }),
      mk({ sessionKey: "b", source: "codex", costUSD: 9 }),
      mk({ sessionKey: "c", source: "claude", costUSD: 100 }),
    ];
    const out = applySessionView(
      items,
      state({ sources: new Set(["codex"]), sortKey: "cost", order: "desc" }),
    );
    expect(out.map((s) => s.sessionKey)).toEqual(["b", "a"]);
  });
});
