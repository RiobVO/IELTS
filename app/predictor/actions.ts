"use server";

/**
 * Грейдинг публичного Band Predictor (G1-6).
 *
 * SERVER-ONLY по необходимости, а не по привычке: ключи банка (`bank.ts`) никогда
 * не попадают в клиентский бандл, клиент присылает только ответы и получает только
 * вердикт — та же дисциплина, что в основном экзамене (§4.6).
 *
 * Результат кладём в httpOnly-cookie, а не в БД: гость — не пользователь, заводить
 * ему строку (и хранить его ответы) ради тизера незачем. Cookie переживает
 * signup-круг, поэтому после регистрации та же страница показывает полный разбор.
 * Подделать её содержимое пользователь может только себе же в убыток (увидит
 * красивое число, которого не заслужил) — ни доступа, ни денег она не открывает.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { captureServer } from "@/lib/analytics/server";
import { checkIpThrottle } from "@/lib/anti-bot/ip-throttle";
import { logError } from "@/lib/monitoring/log-error";
import { PREDICTOR_QUESTIONS } from "@/lib/predictor/bank";
import { gradePredictor } from "@/lib/predictor/grade";
import {
  PREDICTOR_COOKIE_MAX_AGE_SECONDS,
  PREDICTOR_COOKIE_NAME,
  parsePredictorCookie,
  type PredictorSnapshot,
} from "@/lib/predictor/snapshot";

export type PredictorActionResult =
  | { ok: true; snapshot: PredictorSnapshot }
  | { ok: false; reason: "throttled" | "failed" };

export async function submitPredictor(
  answers: Record<string, string>,
): Promise<PredictorActionResult> {
  try {
    if (await checkIpThrottle("predictor")) return { ok: false, reason: "throttled" };

    const result = gradePredictor(PREDICTOR_QUESTIONS, answers);
    const snapshot: PredictorSnapshot = {
      c: result.correct,
      t: result.total,
      w: result.weakType,
      l: result.bandLow,
      h: result.bandHigh,
    };

    const jar = await cookies();
    jar.set(PREDICTOR_COOKIE_NAME, JSON.stringify(snapshot), {
      maxAge: PREDICTOR_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });

    // Воронка (§11): гость ещё не пользователь, distinctId'а нет — берём стабильный
    // якорь запроса (тот же x-forwarded-for, что у throttle) вместо выдуманного id,
    // чтобы не плодить в PostHog персон-однодневок. best-effort.
    const h = await headers();
    const anon = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await captureServer("predictor_complete", `guest:${anon}`, {
      correct: result.correct,
      total: result.total,
      weak_type: result.weakType ?? "",
      band_low: result.bandLow,
    });

    return { ok: true, snapshot };
  } catch (e) {
    await logError({
      source: "server",
      message: `submitPredictor failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      context: { op: "submitPredictor" },
    });
    return { ok: false, reason: "failed" };
  }
}

/** Снимок последней пробы этого браузера (или null). Читает страница после signup. */
export async function readPredictorSnapshot(): Promise<PredictorSnapshot | null> {
  const jar = await cookies();
  return parsePredictorCookie(jar.get(PREDICTOR_COOKIE_NAME)?.value);
}
