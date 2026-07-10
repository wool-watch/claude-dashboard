import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { getQueueSnapshot } from "@/lib/analysis/queue";
import {
  getAnalysisWithStaleness,
  isAnalysisInflight,
} from "@/lib/analysis/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const [result, queue] = await Promise.all([
      getAnalysisWithStaleness(id),
      getQueueSnapshot(),
    ]);
    if (result === null) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...result,
      isAnalyzing: isAnalysisInflight(id),
      isQueued: queue.items.some(
        (i) => i.sessionId === id && i.state === "pending",
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
