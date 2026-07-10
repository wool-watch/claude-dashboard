import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";
import { getAllAnalyses } from "@/lib/analysis/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analyses = await getAllAnalyses();
    return NextResponse.json(aggregateAnalyses(analyses));
  } catch (e) {
    return errorResponse(e);
  }
}
