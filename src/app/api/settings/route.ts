import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { ApiQueryError } from "@/lib/api/query";
import { getConfig } from "@/lib/config";
import {
  parseRetentionDays,
  readSettings,
  writeSettings,
} from "@/lib/settings/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readSettings(getConfig().settingsPath);
    return NextResponse.json(settings);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiQueryError("invalid JSON body");
    }
    const retentionDays = parseRetentionDays(
      (body as Record<string, unknown> | null)?.retentionDays,
    );
    const settings = { retentionDays };
    await writeSettings(getConfig().settingsPath, settings);
    return NextResponse.json(settings);
  } catch (e) {
    return errorResponse(e);
  }
}
