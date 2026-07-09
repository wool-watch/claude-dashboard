import { NextResponse } from "next/server";
import { ApiQueryError } from "@/lib/api/query";

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiQueryError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
