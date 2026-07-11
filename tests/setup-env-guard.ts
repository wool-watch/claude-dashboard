import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";

// テストが CLAUDE_* パスの差し替えを忘れても実データ（~/.claude / ~/.claude-dashboard）に
// 触れないための安全網。かつて archive-sync のテストが analysisDir の差し替え漏れで
// 実データのセッション分析を全削除した事故の再発防止。
// setupFiles の beforeEach は各テストファイルの beforeEach より先に実行されるため、
// テスト側は従来どおり自前の一時ディレクトリで上書きできる。
const sandbox = mkdtempSync(path.join(os.tmpdir(), "claude-dash-test-guard-"));

beforeEach(() => {
  process.env.CLAUDE_DATA_DIR = path.join(sandbox, "projects");
  process.env.CLAUDE_ARCHIVE_DIR = path.join(sandbox, "archive");
  process.env.CLAUDE_ANALYSIS_DIR = path.join(sandbox, "analysis");
  process.env.CLAUDE_SETTINGS_PATH = path.join(sandbox, "settings.json");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});
