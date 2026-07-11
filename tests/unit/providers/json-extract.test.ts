import { describe, expect, it } from "vitest";
import { AnalysisError } from "@/lib/analysis/errors";
import { extractJson, stripCodeFence } from "@/lib/analysis/providers/json-extract";

describe("stripCodeFence", () => {
  it("```json フェンスを剥がす", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("言語指定なしフェンスも剥がす", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("フェンスが無ければそのまま返す", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("extractJson", () => {
  it("素の JSON オブジェクトをパースする", () => {
    expect(extractJson('{"summary":"ok","n":1}')).toEqual({
      summary: "ok",
      n: 1,
    });
  });

  it("コードフェンス付き JSON をパースする", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("前置きテキスト付きでも最初の { から最後の } を抽出する", () => {
    expect(extractJson('以下が結果です:\n{"a":{"b":2}}')).toEqual({
      a: { b: 2 },
    });
  });

  it("後置きテキスト付きでも抽出する", () => {
    expect(extractJson('{"a":1}\n以上です。')).toEqual({ a: 1 });
  });

  it("前後にテキストがあっても抽出する", () => {
    expect(extractJson('結果:\n```json\n{"a":[1,2]}\n```\n以上')).toEqual({
      a: [1, 2],
    });
  });

  it("JSON が無ければ AnalysisError(invalid-output) を投げる", () => {
    try {
      extractJson("すみません、生成できませんでした");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });

  it("壊れた JSON（括弧はあるがパース不能）も invalid-output", () => {
    try {
      extractJson("{ not json }");
      expect.unreachable();
    } catch (e) {
      expect((e as AnalysisError).kind).toBe("invalid-output");
    }
  });
});
