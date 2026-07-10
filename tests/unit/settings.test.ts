import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiQueryError } from "@/lib/api/query";
import {
  DEFAULT_SETTINGS,
  parseAnalysisModel,
  parseRetentionDays,
  readSettings,
  writeSettings,
} from "@/lib/settings/settings";

let tmpDir: string;
let settingsPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-settings-"));
  settingsPath = path.join(tmpDir, "settings.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readSettings", () => {
  it("ファイルが無ければデフォルト（無制限）を返す", async () => {
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.retentionDays).toBeNull();
  });

  it("破損した JSON はデフォルトにフォールバックする", async () => {
    writeFileSync(settingsPath, "{not json");
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });

  it("不正な retentionDays 値はデフォルトにフォールバックする", async () => {
    writeFileSync(settingsPath, JSON.stringify({ retentionDays: 60 }));
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("writeSettings", () => {
  it("書き込んだ設定を読み戻せる", async () => {
    await writeSettings(settingsPath, {
      retentionDays: 90,
      analysisModel: "sonnet",
    });
    expect(await readSettings(settingsPath)).toEqual({
      retentionDays: 90,
      analysisModel: "sonnet",
    });
  });

  it("無制限（null）も往復できる", async () => {
    await writeSettings(settingsPath, {
      retentionDays: 90,
      analysisModel: "haiku",
    });
    await writeSettings(settingsPath, {
      retentionDays: null,
      analysisModel: "haiku",
    });
    expect((await readSettings(settingsPath)).retentionDays).toBeNull();
  });

  it("親ディレクトリが無ければ作成する", async () => {
    const nested = path.join(tmpDir, "a", "b", "settings.json");
    await writeSettings(nested, { retentionDays: 30, analysisModel: "haiku" });
    expect((await readSettings(nested)).retentionDays).toBe(30);
  });

  it("一時ファイルを残さない（アトミック書き込み）", async () => {
    await writeSettings(settingsPath, {
      retentionDays: 180,
      analysisModel: "haiku",
    });
    expect(existsSync(settingsPath)).toBe(true);
    expect(readdirSync(tmpDir)).toEqual(["settings.json"]);
  });
});

describe("readSettings: analysisModel と後方互換", () => {
  it("デフォルトの analysisModel は haiku", () => {
    expect(DEFAULT_SETTINGS.analysisModel).toBe("haiku");
  });

  it("旧形式（retentionDaysのみ）は analysisModel を haiku で補完し retentionDays を保持する", async () => {
    writeFileSync(settingsPath, JSON.stringify({ retentionDays: 90 }));
    expect(await readSettings(settingsPath)).toEqual({
      retentionDays: 90,
      analysisModel: "haiku",
    });
  });

  it("不正な analysisModel はデフォルトへ、retentionDays は保持（キー別フォールバック）", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ retentionDays: 30, analysisModel: "opus" }),
    );
    expect(await readSettings(settingsPath)).toEqual({
      retentionDays: 30,
      analysisModel: "haiku",
    });
  });

  it("不正な retentionDays でも analysisModel は保持", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ retentionDays: 60, analysisModel: "sonnet" }),
    );
    expect(await readSettings(settingsPath)).toEqual({
      retentionDays: null,
      analysisModel: "sonnet",
    });
  });
});

describe("parseAnalysisModel", () => {
  it.each(["haiku", "sonnet"])("%s を受理する", (v) => {
    expect(parseAnalysisModel(v)).toBe(v);
  });

  it.each(["opus", "gpt-4", 5, null, undefined])(
    "不正値 %s は ApiQueryError を投げる",
    (v) => {
      expect(() => parseAnalysisModel(v)).toThrow(ApiQueryError);
    },
  );
});

describe("parseRetentionDays", () => {
  it.each([30, 90, 120, 150, 180, null])("%s を受理する", (v) => {
    expect(parseRetentionDays(v)).toBe(v);
  });

  it.each([60, "30", undefined, true, {}, Number.NaN])(
    "不正値 %s は ApiQueryError を投げる",
    (v) => {
      expect(() => parseRetentionDays(v)).toThrow(ApiQueryError);
    },
  );
});
