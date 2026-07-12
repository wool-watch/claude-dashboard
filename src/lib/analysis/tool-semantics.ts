import type { SessionSourceId } from "@/lib/sources/types";

/**
 * ソース別のツール解釈（決定論的メトリクス用）。
 * 各CLIの編集系ツールを共通の EditOp へ、実行系ツールをコマンド文字列へ写像する。
 */

export interface EditOp {
  file: string;
  added: number;
  removed: number;
}

type AnyRecord = Record<string, unknown>;

const isObject = (v: unknown): v is AnyRecord =>
  typeof v === "object" && v !== null;

const lineCount = (s: unknown): number =>
  typeof s === "string" && s !== "" ? s.split("\n").length : 0;

// ---- claude（従来の挙動） ----

function claudeEditOps(name: string, input: unknown): EditOp[] {
  if (!isObject(input)) return [];
  if (name === "Edit") {
    if (typeof input.file_path !== "string") return [];
    return [
      {
        file: input.file_path,
        added: lineCount(input.new_string),
        removed: lineCount(input.old_string),
      },
    ];
  }
  if (name === "Write") {
    if (typeof input.file_path !== "string") return [];
    return [{ file: input.file_path, added: lineCount(input.content), removed: 0 }];
  }
  if (name === "MultiEdit") {
    if (typeof input.file_path !== "string" || !Array.isArray(input.edits)) {
      return [];
    }
    let added = 0;
    let removed = 0;
    for (const e of input.edits) {
      if (!isObject(e)) continue;
      added += lineCount(e.new_string);
      removed += lineCount(e.old_string);
    }
    return [{ file: input.file_path, added, removed }];
  }
  if (name === "NotebookEdit") {
    if (typeof input.notebook_path !== "string") return [];
    return [
      { file: input.notebook_path, added: lineCount(input.new_source), removed: 0 },
    ];
  }
  return [];
}

// ---- codex ----

/**
 * apply_patch のエンベロープ（*** Update/Add/Delete File: ...）から
 * 対象ファイルと ± 行数を推定する。
 */
function parseApplyPatch(patch: string): EditOp[] {
  const ops = new Map<string, EditOp>();
  let current: EditOp | null = null;
  for (const line of patch.split("\n")) {
    const m = /^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/.exec(line.trim());
    if (m !== null) {
      const file = m[2].trim();
      current = ops.get(file) ?? { file, added: 0, removed: 0 };
      ops.set(file, current);
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
  }
  return [...ops.values()];
}

/** apply_patch の input からパッチ本文を取り出す（文字列 or {input} or {patch}） */
const applyPatchText = (input: unknown): string | null => {
  if (typeof input === "string") return input;
  if (isObject(input)) {
    if (typeof input.input === "string") return input.input;
    if (typeof input.patch === "string") return input.patch;
  }
  return null;
};

function codexEditOps(name: string, input: unknown): EditOp[] {
  if (name !== "apply_patch") return [];
  const patch = applyPatchText(input);
  return patch === null ? [] : parseApplyPatch(patch);
}

/** exec の JS 文字列入力から {"cmd":"..."} を best-effort で抜き出す */
const execCmdFromScript = (script: string): string | null => {
  const m = /"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(script);
  if (m === null) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
};

function codexCommand(name: string, input: unknown): string | null {
  if (name === "exec") {
    if (typeof input === "string") return execCmdFromScript(input);
    if (isObject(input) && typeof input.cmd === "string") return input.cmd;
    return null;
  }
  if (name === "shell" || name === "local_shell" || name === "container.exec") {
    if (!isObject(input)) return null;
    const command = input.command;
    if (Array.isArray(command)) {
      return command.filter((c): c is string => typeof c === "string").join(" ");
    }
    if (typeof command === "string") return command;
    return null;
  }
  return null;
}

// ---- gemini ----

function geminiEditOps(name: string, input: unknown): EditOp[] {
  if (!isObject(input)) return [];
  if (name === "replace" || name === "edit") {
    if (typeof input.file_path !== "string") return [];
    return [
      {
        file: input.file_path,
        added: lineCount(input.new_string),
        removed: lineCount(input.old_string),
      },
    ];
  }
  if (name === "write_file") {
    if (typeof input.file_path !== "string") return [];
    return [{ file: input.file_path, added: lineCount(input.content), removed: 0 }];
  }
  return [];
}

function geminiCommand(name: string, input: unknown): string | null {
  if (name !== "run_shell_command") return null;
  if (isObject(input) && typeof input.command === "string") return input.command;
  return null;
}

// ---- 公開API ----

/** 編集系 tool_use を EditOp の配列へ（該当しないツールは空配列） */
export function toEditOps(
  source: SessionSourceId,
  name: string,
  input: unknown,
): EditOp[] {
  switch (source) {
    case "codex":
      return codexEditOps(name, input);
    case "gemini":
      return geminiEditOps(name, input);
    default:
      return claudeEditOps(name, input);
  }
}

/** 実行系 tool_use からシェルコマンド文字列を取り出す（テスト検出用） */
export function extractShellCommand(
  source: SessionSourceId,
  name: string,
  input: unknown,
): string | null {
  switch (source) {
    case "codex":
      return codexCommand(name, input);
    case "gemini":
      return geminiCommand(name, input);
    default:
      if (name !== "Bash") return null;
      if (isObject(input) && typeof input.command === "string") {
        return input.command;
      }
      return null;
  }
}
