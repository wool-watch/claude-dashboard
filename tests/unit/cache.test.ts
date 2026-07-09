import { describe, expect, it, vi } from "vitest";
import { createSessionCache, getGlobalCache } from "@/lib/store/cache";
import { mkSession, mkTurn } from "./helpers";

const session = (id: string) =>
  mkSession(id, [mkTurn("2026-07-01T00:00:00.000Z")]);

describe("SessionCache", () => {
  it("初回は parse を呼び、同一 stat の2回目はキャッシュを返す", () => {
    const cache = createSessionCache();
    const parse = vi.fn(() => session("s1"));
    const stat = { mtimeMs: 1000, size: 500 };

    const first = cache.getOrParse("/a.jsonl", stat, parse);
    const second = cache.getOrParse("/a.jsonl", stat, parse);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("mtime が変わると再パースする", () => {
    const cache = createSessionCache();
    const parse = vi.fn(() => session("s1"));
    cache.getOrParse("/a.jsonl", { mtimeMs: 1000, size: 500 }, parse);
    cache.getOrParse("/a.jsonl", { mtimeMs: 2000, size: 500 }, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("size が変わると再パースする（mtime 精度対策）", () => {
    const cache = createSessionCache();
    const parse = vi.fn(() => session("s1"));
    cache.getOrParse("/a.jsonl", { mtimeMs: 1000, size: 500 }, parse);
    cache.getOrParse("/a.jsonl", { mtimeMs: 1000, size: 600 }, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("prune は現存パス以外のエントリを削除する", () => {
    const cache = createSessionCache();
    const parseA = vi.fn(() => session("a"));
    const parseB = vi.fn(() => session("b"));
    const stat = { mtimeMs: 1000, size: 500 };
    cache.getOrParse("/a.jsonl", stat, parseA);
    cache.getOrParse("/b.jsonl", stat, parseB);

    cache.prune(new Set(["/a.jsonl"]));

    cache.getOrParse("/a.jsonl", stat, parseA); // ヒット
    cache.getOrParse("/b.jsonl", stat, parseB); // パージ済み → 再パース
    expect(parseA).toHaveBeenCalledTimes(1);
    expect(parseB).toHaveBeenCalledTimes(2);
  });

  it("clear で全消去する", () => {
    const cache = createSessionCache();
    const parse = vi.fn(() => session("s1"));
    const stat = { mtimeMs: 1000, size: 500 };
    cache.getOrParse("/a.jsonl", stat, parse);
    cache.clear();
    cache.getOrParse("/a.jsonl", stat, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("getGlobalCache は同一インスタンスを返す（HMR対策シングルトン）", () => {
    expect(getGlobalCache()).toBe(getGlobalCache());
  });
});
