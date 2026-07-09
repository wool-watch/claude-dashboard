import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { buildSummary } from "@/lib/aggregate/summary";
import { getAllSessions } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await getAllSessions();
    return NextResponse.json(buildSummary(sessions));
  } catch (e) {
    return errorResponse(e);
  }
}
