import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { Badge, EmptyState } from "@/components/ui";
import { totalTokens, type Turn } from "@/lib/types";

const shortModel = (model: string): string => model.replace(/^claude-/, "");

function TurnCard({ turn, index }: { turn: Turn; index: number }) {
  const tokenRows: Array<[string, number]> = [
    ["入力", turn.usage.inputTokens],
    ["出力", turn.usage.outputTokens],
    ["書込5m", turn.usage.cacheWrite5mTokens],
    ["書込1h", turn.usage.cacheWrite1hTokens],
    ["読取", turn.usage.cacheReadTokens],
  ];

  return (
    <li className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2 text-xs text-black/50 dark:text-white/50">
        <span className="font-semibold text-black/70 dark:text-white/70">
          #{index + 1}
        </span>
        <span className="tabular-nums">{formatDateTimeJa(turn.startedAt)}</span>
        <span>所要 {formatDurationJa(turn.durationMs)}</span>
        {turn.models.map((m) => (
          <Badge key={m} tone="gray">
            {shortModel(m)}
          </Badge>
        ))}
        {turn.hasSidechain && <Badge tone="purple">サブエージェント</Badge>}
        {turn.costIsEstimated && <Badge tone="amber">推定</Badge>}
        <span className="ml-auto font-semibold text-black/70 dark:text-white/70">
          {formatUSD(turn.costUSD)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
        {turn.userText === "" ? "（本文なし）" : turn.userText}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/60 dark:text-white/60">
        <span className="tabular-nums">
          合計 {formatTokens(totalTokens(turn.usage))} tokens
        </span>
        {tokenRows
          .filter(([, v]) => v > 0)
          .map(([label, v]) => (
            <span key={label} className="tabular-nums">
              {label} {formatTokens(v)}
            </span>
          ))}
        <span>応答 {turn.assistantMessageCount}件</span>
      </div>

      {Object.keys(turn.toolCounts).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(turn.toolCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([tool, count]) => (
              <Badge key={tool} tone="gray">
                {tool} ×{count}
              </Badge>
            ))}
        </div>
      )}
    </li>
  );
}

export function TurnTimeline({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return <EmptyState message="ターンがありません" />;
  return (
    <ol className="space-y-3">
      {turns.map((turn, i) => (
        <TurnCard key={`${turn.promptId ?? "implicit"}-${i}`} turn={turn} index={i} />
      ))}
    </ol>
  );
}
