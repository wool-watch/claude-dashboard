import { formatDurationJa, formatTokens, formatUSD } from "@/components/format";
import { Badge } from "@/components/ui";
import type { ApiSummary, PeriodStats } from "@/lib/types";

interface CardDef {
  label: string;
  render: (p: PeriodStats) => string;
  badge?: string;
}

export function SummaryCards({ summary }: { summary: ApiSummary }) {
  const cards: CardDef[] = [
    {
      label: "総コスト",
      render: (p) => formatUSD(p.costUSD),
      badge: summary.costIsEstimated ? "推定含む" : undefined,
    },
    { label: "総トークン", render: (p) => formatTokens(p.totalTokens) },
    {
      label: "セッション / ターン",
      render: (p) => `${p.sessionCount} / ${p.turnCount}`,
    },
    { label: "総操作時間", render: (p) => formatDurationJa(p.activeTimeMs) },
  ];

  const periods: Array<[string, PeriodStats]> = [
    ["今日", summary.today],
    ["今週", summary.thisWeek],
    ["今月", summary.thisMonth],
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-black/10 p-4 dark:border-white/15"
        >
          <div className="flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
            {card.label}
            {card.badge !== undefined && <Badge tone="amber">{card.badge}</Badge>}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {card.render(summary.totals)}
          </div>
          <dl className="mt-2 space-y-0.5 text-xs text-black/50 dark:text-white/50">
            {periods.map(([name, stats]) => (
              <div key={name} className="flex justify-between">
                <dt>{name}</dt>
                <dd className="tabular-nums">{card.render(stats)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
