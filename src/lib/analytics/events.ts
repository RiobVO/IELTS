/**
 * Каталог продуктовых событий воронки (BRIEF §11): заход → регистрация →
 * старт/сдача теста → апгрейд. Имена и набор свойств — ПРИБИТЫЙ КОНТРАКТ: на эти
 * строки опираются и серверный capture, и дашборды/воронки в PostHog.
 *
 * Правило по PII: в `properties` НИКОГДА не кладём email, имя, пароль и т.п. —
 * только идентификаторы ресурсов и агрегаты. Личность несёт distinctId (= Supabase
 * user.id), и этого достаточно для воронки.
 */
export const AnalyticsEvent = {
  Signup: "signup",
  TestStart: "test_start",
  TestSubmit: "test_submit",
  Upgrade: "upgrade",
} as const;

/** Свойства каждого события (ключ объекта = имя события в PostHog). */
export type EventProperties = {
  signup: {
    auth_provider: "email" | "apple" | "facebook" | "google";
    has_ref: boolean;
  };
  test_start: {
    content_item_id: string;
    section: string;
    category: string;
    tier_required: string;
    mode: "practice" | "mock";
  };
  test_submit: {
    content_item_id: string;
    raw_score: number;
    total: number;
    time_used_seconds: number;
    mode: "practice" | "mock";
  };
  upgrade: { provider: string; tier: string; period_months: number };
};

/** Имена событий — производны от контракта свойств, чтобы не разъехались. */
export type AnalyticsEventName = keyof EventProperties;
