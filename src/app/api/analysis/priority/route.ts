import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import {
  getPriorityAnalysis,
  isPriorityAnalysisInflight,
  runPriorityAnalysis,
} from "@/lib/analysis/priority-service";
import { parsePriorityAnalysisModel } from "@/lib/analysis/priority-types";
import { AnalysisError } from "@/lib/analysis/runner";

export const dynamic = "force-dynamic";

const STATUS_BY_KIND: Record<AnalysisError["kind"], number> = {
  "in-flight": 409,
  "no-conversation": 400,
  "no-analyses": 400,
  "cli-not-found": 502,
  "cli-failed": 502,
  timeout: 502,
  "invalid-output": 502,
  aborted: 409, // 優先課題分析では発生しない（型の網羅のため）
};

export async function POST(req: NextRequest) {
  try {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      // body 不正は model 検証で 400 にする
    }
    const model = parsePriorityAnalysisModel(
      (body as { model?: unknown } | null)?.model,
    );
    if (model === null) {
      return NextResponse.json(
        { error: "model は haiku / sonnet / opus のいずれかを指定してください" },
        { status: 400 },
      );
    }
    const priority = await runPriorityAnalysis(model);
    return NextResponse.json({ priority });
  } catch (e) {
    if (e instanceof AnalysisError) {
      // メッセージはそのままUIに表示する（CLI未インストール・タイムアウト等）
      return NextResponse.json(
        { error: e.message },
        { status: STATUS_BY_KIND[e.kind] },
      );
    }
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      priority: await getPriorityAnalysis(),
      isAnalyzing: isPriorityAnalysisInflight(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
