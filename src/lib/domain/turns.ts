import { isToolResultOnly } from "@/lib/parser/records";
import type { UserRecord } from "@/lib/types";

/**
 * これらのタグで始まる user レコードは CLI が生成した記録行
 * （`!` コマンドのログ等）で、独自 promptId を持つことがあるが
 * チャットターンとしては扱わない（D-2）。
 */
export const META_TAG_PREFIXES: readonly string[] = [
  "<local-command-caveat>",
  "<command-name>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<system-reminder>",
];

/** user レコードが新しいターン（チャット）の開始かを判定する */
export function isTurnTrigger(r: UserRecord): boolean {
  if (r.isSidechain === true) return false;
  if (r.isMeta === true) return false;
  const content = r.message.content;
  if (isToolResultOnly(content)) return false;
  if (
    typeof content === "string" &&
    META_TAG_PREFIXES.some((p) => content.startsWith(p))
  ) {
    return false;
  }
  return true;
}
