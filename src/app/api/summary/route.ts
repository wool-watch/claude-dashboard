import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { buildSummary } from "@/lib/aggregate/summary";
import { getAllSessions } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get("project");
    const sessions = await getAllSessions();
    const filtered =
      project === null
        ? sessions
        : sessions.filter((s) => s.projectId === project);
    return NextResponse.json(buildSummary(filtered));
  } catch (e) {
    return errorResponse(e);
  }
}
