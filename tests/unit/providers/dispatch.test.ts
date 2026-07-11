import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisError } from "@/lib/analysis/errors";
import {
  PROVIDER_LABELS,
  resolveProviderModel,
  runWithProvider,
} from "@/lib/analysis/providers";
import { getConfig } from "@/lib/config";
import type { AppSettings } from "@/lib/settings/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "claude-dash-dispatch-"));
});

afterEach(() => {
  delete process.env.CLAUDE_CLI_PATH;
  delete process.env.OPENAI_COMPAT_API_KEY;
  vi.unstubAllGlobals();
  rmSync(tmpDir, { recursive: true, force: true });
});

const SCHEMA = { type: "object" } as const;

const baseOptions = { jsonSchema: SCHEMA, systemPrompt: "SP" };

const makeSettings = (mutate?: (s: AppSettings) => void): AppSettings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  mutate?.(s);
  return s;
};

/** claude 形式のエンベロープを返すフェイク CLI */
const makeFakeClaude = () => {
  const cliPath = path.join(tmpDir, "fake-claude.sh");
  writeFileSync(
    cliPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${tmpDir}/argv.txt"\ncat > /dev/null\n` +
      `printf '%s' '{"result":{"via":"claude"},"is_error":false,"total_cost_usd":0.01}'\n`,
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
};

/** --output-last-message へ結果を書くフェイク codex CLI */
const makeFakeCodex = () => {
  const cliPath = path.join(tmpDir, "fake-codex.sh");
  writeFileSync(
    cliPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > "${tmpDir}/argv.txt"`,
      "cat > /dev/null",
      'out=""; prev=""',
      'for a in "$@"; do [ "$prev" = "--output-last-message" ] && out="$a"; prev="$a"; done',
      `printf '%s' '{"via":"codex"}' > "$out"`,
    ].join("\n"),
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
};

/** gemini 形式のエンベロープを返すフェイク CLI */
const makeFakeGemini = () => {
  const cliPath = path.join(tmpDir, "fake-gemini.sh");
  writeFileSync(
    cliPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${tmpDir}/argv.txt"\ncat > /dev/null\n` +
      `printf '%s' '{"response":"{\\"via\\":\\"gemini\\"}","stats":{}}'\n`,
  );
  chmodSync(cliPath, 0o755);
  return cliPath;
};

/** chat/completions 成功を返す fetch モック */
const stubFetchCompletion = (content: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return calls;
};

describe("runWithProvider: ルーティング", () => {
  it("claude は設定の cliPath とモデルで claude アダプタへ委譲する", async () => {
    const cliPath = makeFakeClaude();
    const settings = makeSettings((s) => {
      s.providers.claude = { model: "sonnet", cliPath };
    });

    const outcome = await runWithProvider("p", baseOptions, settings, getConfig());

    expect(outcome.result).toEqual({ via: "claude" });
    expect(outcome.costUSD).toBe(0.01);
    const argv = readArgv();
    expect(argv).toContain("--model");
    expect(argv).toContain("sonnet");
  });

  it("claude の cliPath が空なら config.claudeCliPath を使う", async () => {
    process.env.CLAUDE_CLI_PATH = makeFakeClaude();
    const settings = makeSettings();

    const outcome = await runWithProvider("p", baseOptions, settings, getConfig());
    expect(outcome.result).toEqual({ via: "claude" });
  });

  it("codex は codex アダプタへ委譲する", async () => {
    const cliPath = makeFakeCodex();
    const settings = makeSettings((s) => {
      s.analysisProvider = "codex";
      s.providers.codex = { model: "o4-mini", cliPath };
    });

    const outcome = await runWithProvider("p", baseOptions, settings, getConfig());

    expect(outcome.result).toEqual({ via: "codex" });
    expect(outcome.costUSD).toBeNull();
    const argv = readArgv();
    expect(argv).toContain("exec");
    expect(argv).toContain("o4-mini");
  });

  it("gemini は gemini アダプタへ委譲する", async () => {
    const cliPath = makeFakeGemini();
    const settings = makeSettings((s) => {
      s.analysisProvider = "gemini";
      s.providers.gemini = { model: "gemini-2.5-pro", cliPath };
    });

    const outcome = await runWithProvider("p", baseOptions, settings, getConfig());

    expect(outcome.result).toEqual({ via: "gemini" });
    const argv = readArgv();
    expect(argv).toContain("gemini-2.5-pro");
  });

  it("lmstudio は設定の baseUrl へ fetch し、Authorization を付けない", async () => {
    const calls = stubFetchCompletion('{"via":"lmstudio"}');
    const settings = makeSettings((s) => {
      s.analysisProvider = "lmstudio";
      s.providers.lmstudio = {
        model: "qwen3",
        baseUrl: "http://127.0.0.1:9999/v1",
      };
    });

    const outcome = await runWithProvider("p", baseOptions, settings, getConfig());

    expect(outcome.result).toEqual({ via: "lmstudio" });
    expect(calls[0].url).toBe("http://127.0.0.1:9999/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body)) as { model: string };
    expect(body.model).toBe("qwen3");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("openaiCompatible は設定の apiKey を Authorization に使う", async () => {
    const calls = stubFetchCompletion('{"via":"compat"}');
    const settings = makeSettings((s) => {
      s.analysisProvider = "openaiCompatible";
      s.providers.openaiCompatible = {
        model: "llama3",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "sk-settings",
      };
    });

    await runWithProvider("p", baseOptions, settings, getConfig());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-settings");
  });

  it("環境変数 OPENAI_COMPAT_API_KEY は settings の apiKey より優先", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "sk-env";
    const calls = stubFetchCompletion('{"via":"compat"}');
    const settings = makeSettings((s) => {
      s.analysisProvider = "openaiCompatible";
      s.providers.openaiCompatible = {
        model: "llama3",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "sk-settings",
      };
    });

    await runWithProvider("p", baseOptions, settings, getConfig());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-env");
  });
});

describe("runWithProvider: モデル解決", () => {
  it("options.model が指定されたら設定より優先する", async () => {
    const calls = stubFetchCompletion('{"via":"lmstudio"}');
    const settings = makeSettings((s) => {
      s.analysisProvider = "lmstudio";
      s.providers.lmstudio = { model: "qwen3", baseUrl: "http://x:1/v1" };
    });

    await runWithProvider(
      "p",
      { ...baseOptions, model: "override-model" },
      settings,
      getConfig(),
    );
    const body = JSON.parse(String(calls[0].init.body)) as { model: string };
    expect(body.model).toBe("override-model");
  });

  it("モデル未設定（空文字）はエラーにして実行しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const settings = makeSettings((s) => {
      s.analysisProvider = "lmstudio"; // デフォルトの model は ""
    });

    try {
      await runWithProvider("p", baseOptions, settings, getConfig());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisError);
      expect((e as AnalysisError).kind).toBe("cli-failed");
      expect((e as AnalysisError).message).toContain("設定画面");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveProviderModel / PROVIDER_LABELS", () => {
  it("アクティブプロバイダの設定モデルを返す", () => {
    const settings = makeSettings((s) => {
      s.analysisProvider = "codex";
      s.providers.codex.model = "o4-mini";
    });
    expect(resolveProviderModel(settings)).toBe("o4-mini");
  });

  it("全プロバイダの表示名が定義されている", () => {
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(
      ["claude", "codex", "gemini", "lmstudio", "openaiCompatible"].sort(),
    );
  });
});

/** フェイク CLI が argv.txt に1行1引数でダンプしたものを読む */
function readArgv(): string[] {
  return readFileSync(path.join(tmpDir, "argv.txt"), "utf8").trim().split("\n");
}
