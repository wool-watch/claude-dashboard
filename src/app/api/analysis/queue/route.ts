import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/app/api/respond";
import { enqueueSessions, getQueueSnapshot } from "@/lib/analysis/queue";
import { UUID_RE } from "@/lib/analysis/store";
import { getAllSessions } from "@/lib/store/repository";

export const dynamic = "force-dynamic";

const MAX_ENQUEUE = 500;

export async function GET() {
  try {
    const [queue, sessions] = await Promise.all([
      getQueueSnapshot(),
      getAllSessions(),
    ]);
    const bySession = new Map(
      sessions.map((s) => [
        s.sessionId,
        { title: s.title, projectId: s.projectId, projectPath: s.projectPath },
      ]),
    );
    const items = queue.items.map((item) => {
      const session = bySession.get(item.sessionId);
      return {
        ...item,
        // 消滅セッションは null（UI は sessionId 先頭で代替表示）
        title: session?.title ?? null,
        projectId: session?.projectId ?? null,
        projectPath: session?.projectPath ?? null,
      };
    });
    return NextResponse.json({
      paused: queue.paused,
      items,
      counts: {
        pending: queue.items.filter((i) => i.state === "pending").length,
        running: queue.items.filter((i) => i.state === "running").length,
        failed: queue.items.filter((i) => i.state === "failed").length,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      // body 不正は下の検証で 400 にする
    }
    const sessionIds = (body as { sessionIds?: unknown } | null)?.sessionIds;
    if (
      !Array.isArray(sessionIds) ||
      sessionIds.length === 0 ||
      sessionIds.length > MAX_ENQUEUE ||
      !sessionIds.every((id) => typeof id === "string" && UUID_RE.test(id))
    ) {
      return NextResponse.json(
        { error: `sessionIds は UUID の配列（1〜${MAX_ENQUEUE}件）で指定してください` },
        { status: 400 },
      );
    }
    const result = await enqueueSessions(sessionIds);
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
