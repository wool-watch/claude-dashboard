"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { Badge, EmptyState } from "@/components/ui";
import { type SessionSummary, totalTokens } from "@/lib/types";

type SortKey = "lastAt" | "cost" | "turns";

const displayNameOf = (projectPath: string): string => {
  const segments = projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? projectPath;
};

/** モデルIDの表示短縮: claude-opus-4-8 → opus-4-8 */
const shortModel = (model: string): string => model.replace(/^claude-/, "");

export function SessionTable({ sessions }: { sessions: SessionSummary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("lastAt");
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const sign = desc ? -1 : 1;
    return [...sessions].sort((a, b) => {
      switch (sortKey) {
        case "cost":
          return sign * (a.costUSD - b.costUSD);
        case "turns":
          return sign * (a.turnCount - b.turnCount);
        default:
          return sign * a.lastAt.localeCompare(b.lastAt);
      }
    });
  }, [sessions, sortKey, desc]);

  if (sessions.length === 0) return <EmptyState />;

  const header = (key: SortKey, label: string, align = "text-right") => (
    <th
      className={`cursor-pointer select-none py-2 ${align}`}
      onClick={() => {
        if (sortKey === key) setDesc(!desc);
        else {
          setSortKey(key);
          setDesc(true);
        }
      }}
    >
      {label}
      {sortKey === key && <span className="ml-0.5">{desc ? "▼" : "▲"}</span>}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-black/50 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/15">
            <th className="py-2 text-left">タイトル</th>
            <th className="py-2 text-left">プロジェクト</th>
            {header("lastAt", "最終利用", "text-left")}
            {header("turns", "ターン")}
            <th className="py-2 text-left">モデル</th>
            <th className="py-2 text-right">トークン</th>
            {header("cost", "コスト")}
            <th className="py-2 text-right">操作時間</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr
              key={s.sessionId}
              className="border-b border-black/5 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.05]"
            >
              <td className="max-w-72 truncate py-2 pr-3">
                <Link
                  href={`/sessions/${s.sessionId}`}
                  className="hover:underline"
                >
                  {s.title ?? s.sessionId.slice(0, 8)}
                </Link>
              </td>
              <td className="py-2 pr-3 text-black/60 dark:text-white/60">
                {displayNameOf(s.projectPath)}
              </td>
              <td className="py-2 pr-3 tabular-nums text-black/60 dark:text-white/60">
                {formatDateTimeJa(s.lastAt)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.turnCount}</td>
              <td className="py-2 pr-3">
                <span className="flex flex-wrap gap-1">
                  {s.models.map((m) => (
                    <Badge key={m} tone="gray">
                      {shortModel(m)}
                    </Badge>
                  ))}
                </span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatTokens(totalTokens(s.usage))}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatUSD(s.costUSD)}
                {s.costIsEstimated && (
                  <span className="ml-1">
                    <Badge tone="amber">推定</Badge>
                  </span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatDurationJa(s.activeTimeMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
