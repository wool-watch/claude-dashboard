import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/lib/api/host";

/** 全リクエストで Host を検証し、ループバック以外を拒否する（DNSリバインディング対策） */
export function proxy(request: NextRequest): NextResponse {
  if (!isAllowedHost(request.headers.get("host"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}
