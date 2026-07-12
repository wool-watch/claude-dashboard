"use client";

import { useParams } from "next/navigation";
import {
  formatDateTimeJa,
  formatDurationJa,
  formatTokens,
  formatUSD,
} from "@/components/format";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { BackButton } from "@/components/BackButton";
import { TurnTimeline } from "@/components/TurnTimeline";
import { Badge, ErrorNote, Section, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { SESSION_SOURCE_LABELS } from "@/lib/sources/types";
import { type SessionDetail, totalTokens } from "@/lib/types";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, error, loading } = useApi<SessionDetail>(
    `/api/sessions/${id}`,
  );

  if (loading) return <Skeleton className="h-96" />;
  if (error !== null) return <ErrorNote message={error} />;
  if (s === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2">
          <BackButton fallbackHref="/sessions" />
        </div>
        <h1 className="text-lg font-semibold">
          {s.title ?? s.sessionId}
          <span className="ml-2">
            <Badge tone={s.source === "claude" ? "gray" : s.source === "codex" ? "blue" : "amber"}>
              {SESSION_SOURCE_LABELS[s.source]}
            </Badge>
          </span>
          {s.costIsEstimated && (
            <span className="ml-2">
              <Badge tone="amber">推定コスト含む</Badge>
            </span>
          )}
        </h1>
        {s.source === "gemini" && (
          <p className="mt-1 text-[11px] text-black/40 dark:text-white/40">
            Gemini CLI を OAuth 無料枠で利用している場合、実際の請求は発生しません（表示コストは有償API単価による推定です）
          </p>
        )}
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          {s.projectPath} ・ {formatDateTimeJa(s.firstAt)} 〜{" "}
          {formatDateTimeJa(s.lastAt)}
          {s.gitBranch !== null && ` ・ ${s.gitBranch}`}
          {s.version !== null && ` ・ v${s.version}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="コスト" value={formatUSD(s.costUSD)} />
        <StatCard label="トークン" value={formatTokens(totalTokens(s.usage))} />
        <StatCard label="ターン" value={String(s.turnCount)} />
        <StatCard
          label="メッセージ"
          value={
            s.sidechainMessageCount > 0
              ? `${s.messageCount} (+${s.sidechainMessageCount})`
              : String(s.messageCount)
          }
        />
        <StatCard label="操作時間" value={formatDurationJa(s.activeTimeMs)} />
      </div>

      <Section title="AI振り返り">
        <AnalysisPanel sessionId={s.sessionKey} />
      </Section>

      <Section title="ターン別タイムライン">
        <TurnTimeline turns={s.turns} />
      </Section>
    </div>
  );
}
