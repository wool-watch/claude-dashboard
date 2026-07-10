import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { getAnalysisStatusMap } from "@/lib/analysis/service";
import { ApiQueryError } from "@/lib/api/query";
import { getAllSessions } from "@/lib/store/repository";
import type { SessionDetail, SessionSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const toSummary = (s: SessionDetail): SessionSummary => {
  const { turns: _turns, skippedLines: _skipped, ...summary } = s;
  return summary;
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const project = sp.get("project");
    const sort = sp.get("sort") ?? "lastAt";
    const order = sp.get("order") ?? "desc";
    const limitRaw = sp.get("limit");
    const limit = limitRaw === null ? 100 : Number(limitRaw);

    if (sort !== "lastAt" && sort !== "cost") {
      throw new ApiQueryError(`invalid sort: ${sort}`);
    }
    if (order !== "asc" && order !== "desc") {
      throw new ApiQueryError(`invalid order: ${order}`);
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ApiQueryError(`invalid limit: ${limitRaw}`);
    }

    const [allSessions, statusMap] = await Promise.all([
      getAllSessions(),
      getAnalysisStatusMap(),
    ]);
    let sessions = allSessions;
    if (project !== null) {
      sessions = sessions.filter((s) => s.projectId === project);
    }
    const sign = order === "asc" ? 1 : -1;
    const sorted = [...sessions].sort((a, b) =>
      sort === "cost"
        ? sign * (a.costUSD - b.costUSD)
        : sign * a.lastAt.localeCompare(b.lastAt),
    );
    return NextResponse.json({
      sessions: sorted.slice(0, limit).map((s) => ({
        ...toSummary(s),
        analysisStatus: statusMap.get(s.sessionId) ?? "none",
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
