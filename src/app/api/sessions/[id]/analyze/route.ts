import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
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
};

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
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
