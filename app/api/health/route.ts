import { NextResponse } from "next/server";

// Lightweight liveness probe. Intentionally does NOT touch the database or env
// secrets so it stays a fast, dependency-free 200 (used by the verify gate).
// `commit` — VERCEL_GIT_COMMIT_SHA (system env, не секрет): post-deploy smoke
// ждёт на каноническом домене ИМЕННО sha нового деплоя — иначе успешный
// deployment_status до переключения alias озеленял бы старый релиз. Локально/в
// verify — null (гейт проверяет только 200).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "ielts-api",
      phase: 1,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { status: 200 },
  );
}
