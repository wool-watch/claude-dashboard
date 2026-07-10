import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { getAnalysisWithStaleness } from "@/lib/analysis/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const result = await getAnalysisWithStaleness(id);
    if (result === null) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
