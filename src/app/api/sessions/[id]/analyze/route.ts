import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { getQueueSnapshot } from "@/lib/analysis/queue";
import { AnalysisError } from "@/lib/analysis/runner";
import { analyzeSession } from "@/lib/analysis/service";

export const dynamic = "force-dynamic";

const STATUS_BY_KIND: Record<AnalysisError["kind"], number> = {
  "in-flight": 409,
  "no-conversation": 400,
  "no-analyses": 400,
  "cli-not-found": 502,
  "cli-failed": 502,
  timeout: 502,
  "invalid-output": 502,
  aborted: 409, // 手動経路では発生しない（型の網羅のため）
};

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    // キュー待機中はワーカーとの二重実行を防ぐ（解除してから手動実行する）
    const queue = await getQueueSnapshot();
    if (queue.items.some((i) => i.sessionId === id && i.state === "pending")) {
      throw new AnalysisError(
        "このセッションは分析キューで待機中です。解除してから実行してください",
        "in-flight",
      );
    }
    const analysis = await analyzeSession(id);
    if (analysis === null) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json({ analysis, isStale: false });
  } catch (e) {
    if (e instanceof AnalysisError) {
      // メッセージはそのままUIに表示する（CLI未インストール・タイムアウト等）
      return NextResponse.json(
        { error: e.message },
        { status: STATUS_BY_KIND[e.kind] },
      );
    }
    return errorResponse(e);
  }
}
