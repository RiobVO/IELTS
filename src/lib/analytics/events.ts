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
  OnboardingComplete: "onboarding_complete",
  ResultView: "result_view",
  CheckoutStart: "checkout_start",
  CheckoutBlocked: "checkout_blocked",
  PaymentFailed: "payment_failed",
  Preorder: "preorder",
  ContentWaitlist: "content_waitlist",
  SprintSignup: "sprint_signup",
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
  onboarding_complete: { target_band: number; has_region: boolean };
  result_view: { content_item_id: string; mode: "practice" | "mock"; banded: boolean; raw_score: number; total: number };
  checkout_start: { provider: string; tier: string; period_months: number; amount: number };
  /** Оплата недоступна на гейте (paymentsLive=false) — воронка не должна молча
   *  терять этот отвал. `reason` — почему заблокировано (сейчас единственная
   *  причина: мерчант-ключ не сконфигурирован в production). */
  checkout_blocked: {
    provider: string;
    tier: string;
    period_months: number;
    reason: "payments_unavailable";
  };
  /** Неуспешный исход применения платежа (webhook): невалидная сумма/пара,
   *  протухший pending или внутренняя ошибка. Слепая зона воронки до этого шага. */
  payment_failed: { provider: string; reason: "invalid" | "expired" | "error" };
  /** Pre-order early-bird плана (§12) пока оплата не запущена — фиксация намерения
   *  купить в таблице `preorder`, измеряем спрос на платные тарифы до онбординга
   *  мерчанта. Не платёж: только запись намерения. `source_page` — с какой
   *  страницы кликнули (whitelist на сервере — см. isSourcePage в
   *  app/app/upgrade/actions.ts, сырую клиентскую строку в PostHog не пускаем). */
  preorder: { tier: string; period_months: number; source_page: "pricing" | "upgrade" };
  /** Клик по «Notify me when new tests land» в пустом каталоге (контент-вайп,
   *  BRIEF §12.3) — измеряем спрос на свежий контент, пока библиотека пополняется. */
  content_waitlist: { source: "catalog" };
  /** Запись в ручной пилот когорты «спринт к экзамену» (BRIEF §12.3) — связка
   *  user_id ↔ участие для замера retention. Без свойств: коммуникация целиком
   *  в Telegram вне продукта, личность уже несёт distinctId. */
  sprint_signup: Record<string, never>;
};

/** Имена событий — производны от контракта свойств, чтобы не разъехались. */
export type AnalyticsEventName = keyof EventProperties;
