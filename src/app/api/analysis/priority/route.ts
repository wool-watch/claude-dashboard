import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import {
  getPriorityAnalysisState,
  isPriorityAnalysisInflight,
  runPriorityAnalysis,
} from "@/lib/analysis/priority-service";
import { parsePriorityAnalysisModel } from "@/lib/analysis/priority-types";
import { AnalysisError } from "@/lib/analysis/runner";
import { PROJECT_ID_RE } from "@/lib/analysis/store";

export const dynamic = "force-dynamic";

const STATUS_BY_KIND: Record<AnalysisError["kind"], number> = {
  "in-flight": 409,
  "no-conversation": 400,
  "no-analyses": 400,
  "cli-not-found": 502,
  "cli-failed": 502,
  timeout: 502,
  "invalid-output": 502,
  "connection-failed": 502,
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
    // model は省略可（省略時はアクティブプロバイダの設定モデル）。
    // 指定時のみ検証する（claude 以外のプロバイダでは指定は無視される）
    const rawModel = (body as { model?: unknown } | null)?.model;
    let model: string | undefined;
    if (rawModel === undefined) {
      model = undefined;
    } else {
      const parsed = parsePriorityAnalysisModel(rawModel);
      if (parsed === null) {
        return NextResponse.json(
          { error: "model は haiku / sonnet / opus のいずれかを指定してください" },
          { status: 400 },
        );
      }
      model = parsed;
    }
    const project = (body as { project?: unknown } | null)?.project;
    if (
      project !== undefined &&
      (typeof project !== "string" || !PROJECT_ID_RE.test(project))
    ) {
      return NextResponse.json(
        { error: "project の形式が不正です" },
        { status: 400 },
      );
    }
    const priority = await runPriorityAnalysis(model, undefined, project);
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

export async function GET(req?: NextRequest) {
  try {
    const project = req?.nextUrl.searchParams.get("project") ?? null;
    if (project !== null && !PROJECT_ID_RE.test(project)) {
      return NextResponse.json(
        { error: "project の形式が不正です" },
        { status: 400 },
      );
    }
    const projectId = project ?? undefined;
    const { priority, isLegacy } = await getPriorityAnalysisState(projectId);
    return NextResponse.json({
      priority,
      isAnalyzing: isPriorityAnalysisInflight(projectId),
      isLegacy,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
