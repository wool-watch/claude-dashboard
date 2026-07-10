import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";
import { getAllAnalyses } from "@/lib/analysis/service";

export const dynamic = "force-dynamic";

export async function GET(req?: NextRequest) {
  try {
    const project = req?.nextUrl.searchParams.get("project") ?? null;
    const analyses = await getAllAnalyses();
    const filtered =
      project === null
        ? analyses
        : analyses.filter((a) => a.projectId === project);
    return NextResponse.json(aggregateAnalyses(filtered));
  } catch (e) {
    return errorResponse(e);
  }
}
