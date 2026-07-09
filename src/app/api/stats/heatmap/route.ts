import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { aggregateWeekdayHourHeatmap } from "@/lib/aggregate/heatmap";
import { parseDateRange } from "@/lib/api/query";
import { getAllSessions } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const range = parseDateRange(sp);
    const projectId = sp.get("project") ?? undefined;
    const sessions = await getAllSessions();
    return NextResponse.json({
      cells: aggregateWeekdayHourHeatmap(sessions, { ...range, projectId }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
