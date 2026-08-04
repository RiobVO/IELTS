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
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getUser } from "@/lib/auth";
import { captureServer } from "@/lib/analytics/server";
import { checkIpThrottle } from "@/lib/anti-bot/ip-throttle";
import { logError } from "@/lib/monitoring/log-error";
import { PREDICTOR_QUESTIONS } from "@/lib/predictor/bank";
import { gradePredictor } from "@/lib/predictor/grade";
import {
  PREDICTOR_COOKIE_MAX_AGE_SECONDS,
  PREDICTOR_COOKIE_NAME,
  parsePredictorCookie,
  serializePredictorCookie,
  toTeaser,
  type PredictorAnswers,
  type PredictorSnapshot,
  type PredictorTeaserView,
} from "@/lib/predictor/snapshot";

/**
 * Что уходит В БРАУЗЕР после проверки. Гостю НЕ отдаём название слабого типа
 * (Codex-ревью G1-6, P2): UI обещает его «после регистрации», а раньше сервер клал
 * `weakType` прямо в ответ — гейт воронки обходился одним взглядом в DevTools.
 * Гостю едет только факт «слабый тип найден»; сам тип лежит в httpOnly-cookie,
 * которую клиент не читает, и раскрывается серверным рендером уже залогиненному.
 */
export type PredictorTeaser = PredictorTeaserView;

export type PredictorActionResult =
  | { ok: true; snapshot: PredictorTeaser }
  | { ok: false; reason: "throttled" | "failed" };

export async function submitPredictor(
  answers: Record<string, string>,
): Promise<PredictorActionResult> {
  try {
    if (await checkIpThrottle("predictor")) return { ok: false, reason: "throttled" };

    const snapshot = gradeSnapshot(answers);

    // Слабый тип не покидает сервер для гостя ни одним каналом: в cookie уходят
    // ОТВЕТЫ (их гость и так знает), а не вывод — иначе тип был бы виден в
    // Set-Cookie/Application (третий раунд ревью). Смысл ответам придаёт сервер,
    // у которого ключи.
    const authed = !!(await getUser());

    const jar = await cookies();
    jar.set(PREDICTOR_COOKIE_NAME, serializePredictorCookie(answers), {
      maxAge: PREDICTOR_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });

    // Воронка (§11): гость ещё не пользователь, distinctId'а нет — берём стабильный
    // якорь запроса (тот же x-forwarded-for, что у throttle) вместо выдуманного id,
    // чтобы не плодить в PostHog персон-однодневок. best-effort.
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    // Хешируем адрес перед отправкой (Codex-ревью, замечание по приватности): сырой
    // IP как identity внешнего аналитика — лишние персональные данные у третьей
    // стороны. Хеш стабилен в пределах адреса, значит воронка по-прежнему
    // склеивается, но обратно в IP не разворачивается.
    const anon = createHash("sha256").update(`predictor:${ip}`).digest("hex").slice(0, 24);
    await captureServer("predictor_complete", `guest:${anon}`, {
      correct: snapshot.c,
      total: snapshot.t,
      weak_type: snapshot.w ?? "",
      band_low: snapshot.l,
    });

    return { ok: true, snapshot: toTeaser(snapshot, authed) };
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

/**
 * Грейдинг ответов банком (ключи server-only) в форму снимка. Единая точка: и
 * действие, и рендер страницы считают результат ОДИНАКОВО, поэтому «после
 * регистрации» юзер видит ровно тот же вывод, что дала проба.
 */
function gradeSnapshot(answers: PredictorAnswers): PredictorSnapshot {
  const result = gradePredictor(PREDICTOR_QUESTIONS, answers);
  return {
    c: result.correct,
    t: result.total,
    w: result.weakType,
    l: result.bandLow,
    h: result.bandHigh,
  };
}

/** Снимок последней пробы этого браузера (или null): читаем ответы и грейдим их. */
export async function readPredictorSnapshot(): Promise<PredictorSnapshot | null> {
  const jar = await cookies();
  const answers = parsePredictorCookie(jar.get(PREDICTOR_COOKIE_NAME)?.value);
  return answers ? gradeSnapshot(answers) : null;
}
