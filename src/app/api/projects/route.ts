import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { aggregateProjects } from "@/lib/aggregate/projects";
import { getAllSessions } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await getAllSessions();
    return NextResponse.json({ projects: aggregateProjects(sessions) });
  } catch (e) {
    return errorResponse(e);
  }
}
