import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiQueryError } from "@/lib/api/query";
import type { AppSettings } from "@/lib/settings/settings";
import {
  DEFAULT_SETTINGS,
  parseAnalysisModel,
  parseAnalysisProvider,
  parseRetentionDays,
  readSettings,
  toPublicSettings,
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

/** DEFAULT_SETTINGS を汚さないディープコピーにオーバーライドを重ねる */
const makeSettings = (overrides?: Partial<AppSettings>): AppSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...overrides,
});

describe("readSettings", () => {
  it("ファイルが無ければデフォルト（無制限・claude）を返す", async () => {
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.retentionDays).toBeNull();
    expect(DEFAULT_SETTINGS.analysisProvider).toBe("claude");
  });

  it("デフォルトのプロバイダ個別設定が揃っている", () => {
    expect(DEFAULT_SETTINGS.providers).toEqual({
      claude: { model: "haiku", cliPath: "" },
      codex: { model: "gpt-5-codex", cliPath: "codex" },
      gemini: { model: "gemini-2.5-flash", cliPath: "gemini" },
      lmstudio: { model: "", baseUrl: "http://localhost:1234/v1" },
      openaiCompatible: {
        model: "",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "",
      },
    });
  });

  it("破損した JSON はデフォルトにフォールバックする", async () => {
    writeFileSync(settingsPath, "{not json");
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });

  it("不正な retentionDays 値はデフォルトにフォールバックする", async () => {
    writeFileSync(settingsPath, JSON.stringify({ retentionDays: 60 }));
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });

  it("不正な analysisProvider は claude へ、retentionDays は保持（キー別フォールバック）", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ retentionDays: 30, analysisProvider: "chatgpt" }),
    );
    const settings = await readSettings(settingsPath);
    expect(settings.retentionDays).toBe(30);
    expect(settings.analysisProvider).toBe("claude");
  });

  it("analysisProvider を保存・読み戻しできる", async () => {
    writeFileSync(settingsPath, JSON.stringify({ analysisProvider: "lmstudio" }));
    expect((await readSettings(settingsPath)).analysisProvider).toBe("lmstudio");
  });
});

describe("readSettings: providers のフィールド単位フォールバック", () => {
  it("有効なプロバイダ設定は保持し、欠損プロバイダはデフォルトで補完する", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        providers: {
          claude: { model: "sonnet", cliPath: "/usr/local/bin/claude" },
        },
      }),
    );
    const settings = await readSettings(settingsPath);
    expect(settings.providers.claude).toEqual({
      model: "sonnet",
      cliPath: "/usr/local/bin/claude",
    });
    expect(settings.providers.codex).toEqual(DEFAULT_SETTINGS.providers.codex);
    expect(settings.providers.lmstudio).toEqual(
      DEFAULT_SETTINGS.providers.lmstudio,
    );
  });

  it("不正なフィールドはフィールド単位でデフォルトへ（他フィールドは保持）", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        providers: {
          codex: { model: "o4-mini", cliPath: 42 },
          lmstudio: { model: "llama-3", baseUrl: "not-a-url" },
        },
      }),
    );
    const settings = await readSettings(settingsPath);
    expect(settings.providers.codex).toEqual({ model: "o4-mini", cliPath: "codex" });
    expect(settings.providers.lmstudio).toEqual({
      model: "llama-3",
      baseUrl: "http://localhost:1234/v1",
    });
  });

  it("claude の model は haiku/sonnet 以外を受け付けない", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ providers: { claude: { model: "opus" } } }),
    );
    expect((await readSettings(settingsPath)).providers.claude.model).toBe(
      "haiku",
    );
  });

  it("未知のプロバイダキーは無視する", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ providers: { mystery: { model: "x" } } }),
    );
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });

  it("openaiCompatible の apiKey を往復できる", async () => {
    await writeSettings(
      settingsPath,
      (() => {
        const s = makeSettings();
        s.providers.openaiCompatible.apiKey = "sk-test-123";
        return s;
      })(),
    );
    expect((await readSettings(settingsPath)).providers.openaiCompatible.apiKey).toBe(
      "sk-test-123",
    );
  });
});

describe("readSettings: 旧形式 analysisModel からの移行", () => {
  it("旧 analysisModel を providers.claude.model へ移行する", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ retentionDays: 90, analysisModel: "sonnet" }),
    );
    const settings = await readSettings(settingsPath);
    expect(settings.retentionDays).toBe(90);
    expect(settings.providers.claude.model).toBe("sonnet");
    expect(settings.analysisProvider).toBe("claude");
    expect("analysisModel" in settings).toBe(false);
  });

  it("providers.claude.model があれば旧 analysisModel より優先する", async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        analysisModel: "sonnet",
        providers: { claude: { model: "haiku" } },
      }),
    );
    expect((await readSettings(settingsPath)).providers.claude.model).toBe(
      "haiku",
    );
  });

  it("不正な旧 analysisModel は無視してデフォルトのまま", async () => {
    writeFileSync(settingsPath, JSON.stringify({ analysisModel: "opus" }));
    expect(await readSettings(settingsPath)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("writeSettings", () => {
  it("書き込んだ設定を読み戻せる", async () => {
    const settings = makeSettings({ retentionDays: 90, analysisProvider: "codex" });
    settings.providers.claude.model = "sonnet";
    await writeSettings(settingsPath, settings);
    expect(await readSettings(settingsPath)).toEqual(settings);
  });

  it("無制限（null）も往復できる", async () => {
    await writeSettings(settingsPath, makeSettings({ retentionDays: 90 }));
    await writeSettings(settingsPath, makeSettings({ retentionDays: null }));
    expect((await readSettings(settingsPath)).retentionDays).toBeNull();
  });

  it("親ディレクトリが無ければ作成する", async () => {
    const nested = path.join(tmpDir, "a", "b", "settings.json");
    await writeSettings(nested, makeSettings({ retentionDays: 30 }));
    expect((await readSettings(nested)).retentionDays).toBe(30);
  });

  it("一時ファイルを残さない（アトミック書き込み）", async () => {
    await writeSettings(settingsPath, makeSettings({ retentionDays: 180 }));
    expect(existsSync(settingsPath)).toBe(true);
    expect(readdirSync(tmpDir)).toEqual(["settings.json"]);
  });

  it("APIキーを含むためパーミッション 0600 で書き込む", async () => {
    await writeSettings(settingsPath, makeSettings());
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
  });
});

describe("toPublicSettings", () => {
  it("apiKey を含めず hasApiKey に変換する", () => {
    const settings = makeSettings();
    settings.providers.openaiCompatible.apiKey = "sk-secret";
    const pub = toPublicSettings(settings);
    expect(pub.providers.openaiCompatible).toEqual({
      model: "",
      baseUrl: "http://localhost:11434/v1",
      hasApiKey: true,
    });
    expect(JSON.stringify(pub)).not.toContain("sk-secret");
  });

  it("apiKey が空なら hasApiKey は false", () => {
    const pub = toPublicSettings(makeSettings());
    expect(pub.providers.openaiCompatible.hasApiKey).toBe(false);
  });

  it("他プロバイダの設定はそのまま含める", () => {
    const pub = toPublicSettings(makeSettings());
    expect(pub.analysisProvider).toBe("claude");
    expect(pub.providers.claude).toEqual({ model: "haiku", cliPath: "" });
    expect(pub.providers.lmstudio).toEqual({
      model: "",
      baseUrl: "http://localhost:1234/v1",
    });
  });
});

describe("parseAnalysisProvider", () => {
  it.each(["claude", "codex", "gemini", "lmstudio", "openaiCompatible"])(
    "%s を受理する",
    (v) => {
      expect(parseAnalysisProvider(v)).toBe(v);
    },
  );

  it.each(["chatgpt", "", 5, null, undefined])(
    "不正値 %s は ApiQueryError を投げる",
    (v) => {
      expect(() => parseAnalysisProvider(v)).toThrow(ApiQueryError);
    },
  );
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
