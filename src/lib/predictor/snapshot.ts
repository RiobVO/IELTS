/**
 * Снимок пробы Band Predictor в cookie (G1-6). Чистый разбор + контракт формата.
 *
 * Формат намеренно короткий (однобуквенные ключи): cookie едет в каждом запросе к
 * домену, а осмысленных данных тут пять чисел. Никакого PII — ни ответов, ни
 * идентификаторов, только счёт, слабый тип и границы диапазона.
 */

/** Имя cookie со снимком последней пробы. Читают только серверные потребители. */
export const PREDICTOR_COOKIE_NAME = "bando_pred";

/** TTL — 7 дней: снимок нужен, чтобы пережить signup-круг, а не жить вечно. */
export const PREDICTOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface PredictorSnapshot {
  /** correct */ c: number;
  /** total */ t: number;
  /** weakest qtype, null при идеальной пробе */ w: string | null;
  /** band low */ l: number;
  /** band high */ h: number;
}

/**
 * Разбирает значение cookie в снимок или `null`. Валидирует ВСЁ: cookie
 * httpOnly, но пользователь-модифицируема (devtools/proxy), а результат идёт в
 * рендер — «доверять своему же формату» тут нельзя. Некорректный снимок = его нет
 * (страница просто предложит пройти пробу заново).
 */
export function parsePredictorCookie(raw: string | null | undefined): PredictorSnapshot | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Recover: битая cookie равнозначна её отсутствию — гость пройдёт пробу заново.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const c = Number(o.c);
  const t = Number(o.t);
  const l = Number(o.l);
  const h = Number(o.h);
  if (![c, t, l, h].every((n) => Number.isFinite(n))) return null;
  if (t <= 0 || c < 0 || c > t) return null;
  if (l < 0 || h < l || h > 9) return null;
  const w = typeof o.w === "string" && o.w !== "" ? o.w : null;
  return { c, t, w, l, h };
}

/** Что из снимка позволено отдать браузеру. `w` — только залогиненному. */
export interface PredictorTeaserView {
  c: number;
  t: number;
  l: number;
  h: number;
  w: string | null;
  hasWeak: boolean;
}

/**
 * Проекция снимка под ответ клиенту (Codex-ревью G1-6, P2). Гейт воронки обещает
 * название слабого типа ТОЛЬКО после регистрации — значит гостю его нельзя класть
 * и в сетевой ответ, иначе обещание обходится одним взглядом в DevTools. Гостю
 * остаётся факт «слабый тип найден», нужный честному копирайту.
 */
export function toTeaser(snapshot: PredictorSnapshot, authed: boolean): PredictorTeaserView {
  return {
    c: snapshot.c,
    t: snapshot.t,
    l: snapshot.l,
    h: snapshot.h,
    w: authed ? snapshot.w : null,
    hasWeak: snapshot.w !== null,
  };
}
