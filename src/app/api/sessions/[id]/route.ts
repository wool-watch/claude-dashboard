import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { getSession } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const session = await getSession(id);
    if (session === null) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (e) {
    return errorResponse(e);
  }
}
