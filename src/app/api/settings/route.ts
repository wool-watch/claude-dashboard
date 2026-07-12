import { NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { ApiQueryError } from "@/lib/api/query";
import { getConfig } from "@/lib/config";
import {
  applyProvidersPatch,
  applySourcesPatch,
  parseAnalysisProvider,
  parseRetentionDays,
  readSettings,
  toPublicSettings,
  writeSettings,
} from "@/lib/settings/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readSettings(getConfig().settingsPath);
    return NextResponse.json(toPublicSettings(settings));
  } catch (e) {
    return errorResponse(e);
  }
}

/** body に存在するキーのみ検証してマージする部分更新（他キーは現在値を保持） */
export async function PUT(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiQueryError("invalid JSON body");
    }
    if (typeof body !== "object" || body === null) {
      throw new ApiQueryError("invalid JSON body");
    }
    const patch = body as Record<string, unknown>;
    const settingsPath = getConfig().settingsPath;
    const settings = await readSettings(settingsPath);
    let touched = false;
    if ("retentionDays" in patch) {
      settings.retentionDays = parseRetentionDays(patch.retentionDays);
      touched = true;
    }
    if ("analysisProvider" in patch) {
      settings.analysisProvider = parseAnalysisProvider(patch.analysisProvider);
      touched = true;
    }
    if ("providers" in patch) {
      touched = applyProvidersPatch(settings, patch.providers) || touched;
    }
    if ("sources" in patch) {
      touched = applySourcesPatch(settings, patch.sources) || touched;
    }
    if (!touched) {
      throw new ApiQueryError("no valid settings keys in body");
    }
    await writeSettings(settingsPath, settings);
    return NextResponse.json(toPublicSettings(settings));
  } catch (e) {
    return errorResponse(e);
  }
}
