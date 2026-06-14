import { NextResponse } from "next/server";

// Lightweight liveness probe. Intentionally does NOT touch the database or env
// secrets so it stays a fast, dependency-free 200 (used by the verify gate).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "ielts-api", phase: 1 },
    { status: 200 },
  );
}
