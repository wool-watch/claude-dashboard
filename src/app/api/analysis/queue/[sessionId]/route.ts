import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { releaseSession } from "@/lib/analysis/queue";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await ctx.params;
    const released = await releaseSession(sessionId);
    if (!released) {
      return NextResponse.json(
        { error: "キューに存在しません" },
        { status: 404 },
      );
    }
    return NextResponse.json({ released: true });
  } catch (e) {
    return errorResponse(e);
  }
}
