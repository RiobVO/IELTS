/**
 * Cookie-снимок пробы Band Predictor (G1-6). Чистый разбор + контракт формата.
 *
 * ПОЧЕМУ В COOKIE ЛЕЖАТ ОТВЕТЫ, А НЕ РЕЗУЛЬТАТ. Гейт воронки обещает название
 * слабого типа только после регистрации. Пока в cookie лежал посчитанный результат
 * (`{c,t,w,l,h}`), тип уезжал гостю в `Set-Cookie` — `httpOnly` закрывает JS, но не
 * вкладку Network/Application и не прокси (найдено третьим раундом ревью). Теперь
 * браузер уносит только то, что гость и так знает — СВОИ ОТВЕТЫ; смысл им придаёт
 * сервер, у которого лежат ключи (`bank.ts`, server-only). Побочно это дешевле:
 * подделка cookie максимум перегрейдит выдуманные ответы, а не подставит выдуманный
 * вывод.
 */

/** Имя cookie с ответами последней пробы. Читают только серверные потребители. */
export const PREDICTOR_COOKIE_NAME = "bando_pred";

/** TTL — 7 дней: снимок нужен, чтобы пережить signup-круг, а не жить вечно. */
export const PREDICTOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Потолки разбора: проба — 10 вопросов, ответы — короткие строки. */
const MAX_ANSWERS = 20;
const MAX_ANSWER_LEN = 80;

/** Ответы гостя: номер вопроса → его ответ. */
export type PredictorAnswers = Record<string, string>;

/** Результат грейдинга в форме, пригодной для проекции клиенту. */
export interface PredictorSnapshot {
  /** correct */ c: number;
  /** total */ t: number;
  /** weakest qtype, null при идеальной пробе */ w: string | null;
  /** band low */ l: number;
  /** band high */ h: number;
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
 * Разбирает cookie в ответы или `null`. Валидируем ВСЁ: cookie httpOnly, но
 * пользователь-модифицируема (devtools/proxy), а значение идёт в грейдер и в рендер.
 * Мусор равнозначен отсутствию пробы — страница просто предложит пройти её заново.
 * Ключи — только цифры (номера вопросов), значения — строки в пределах потолка;
 * лишние пары отбрасываются, чтобы раздутая cookie не превращалась в нагрузку.
 */
export function parsePredictorCookie(raw: string | null | undefined): PredictorAnswers | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Recover: битая cookie равнозначна её отсутствию.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const answers: PredictorAnswers = {};
  let n = 0;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (n >= MAX_ANSWERS) break;
    if (!/^\d{1,3}$/.test(key)) continue;
    if (typeof value !== "string") continue;
    answers[key] = value.slice(0, MAX_ANSWER_LEN);
    n++;
  }
  return n > 0 ? answers : null;
}

/** Сериализация ответов в cookie (та же форма, что читает parse). */
export function serializePredictorCookie(answers: PredictorAnswers): string {
  const clean: PredictorAnswers = {};
  let n = 0;
  for (const [key, value] of Object.entries(answers)) {
    if (n >= MAX_ANSWERS) break;
    if (!/^\d{1,3}$/.test(key) || typeof value !== "string") continue;
    clean[key] = value.slice(0, MAX_ANSWER_LEN);
    n++;
  }
  return JSON.stringify(clean);
}

/**
 * Проекция результата под ответ клиенту. Гостю название слабого типа не уходит ни
 * ответом действия, ни рендером — только факт «слабый тип найден», нужный честному
 * копирайту.
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
