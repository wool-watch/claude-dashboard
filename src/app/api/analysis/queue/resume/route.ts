import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { resumeQueue } from "@/lib/analysis/queue";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await resumeQueue();
    return NextResponse.json({ paused: false });
  } catch (e) {
    return errorResponse(e);
  }
}
