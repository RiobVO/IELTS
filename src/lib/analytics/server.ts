import "server-only";
import { PostHog } from "posthog-node";
import { posthogConfig } from "@/env";
import type { AnalyticsEventName, EventProperties } from "./events";

/**
 * Серверный, авторитетный capture продуктовых событий (BRIEF §11). distinctId =
 * Supabase user.id — события воронки фиксирует ТОЛЬКО сервер, их нельзя подделать
 * с клиента (тот же принцип server-trust, что у grading в §4.6: клиент шлёт
 * действия, не факты).
 *
 * FAIL-OPEN и best-effort: без ключа PostHog (`posthogConfig() === null`) — no-op;
 * любая ошибка ингеста ловится и логируется, но НИКОГДА не пробрасывается —
 * регистрация, сабмит и выдача доступа важнее телеметрии и не должны падать из-за
 * неё. Антипод payments-стаба: там fail-closed (деньги), здесь fail-open (метрики).
 */

let client: PostHog | null = null;

/** Потолок ожидания доставки. Даже если событие не уйдёт — это лучше, чем
 *  повисший на сети PostHog сабмит/вебхук. */
const FLUSH_TIMEOUT_MS = 2000;

function getClient(): PostHog | null {
  const cfg = posthogConfig();
  if (!cfg) return null;
  // Singleton: в serverless переживает тёплые инвокации; flushAt:1 + flushInterval:0
  // — отправляем сразу, не копим в памяти короткоживущей функции. requestTimeout +
  // НОЛЬ ретраев жёстко ограничивают худший случай: при недоступном PostHog дефолт
  // SDK (10s timeout × 4 попытки + паузы 3×3s) повесил бы запрос на ~49s; здесь — ~2s.
  client ??= new PostHog(cfg.key, {
    host: cfg.host,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: FLUSH_TIMEOUT_MS,
    fetchRetryCount: 0,
  });
  return client;
}

export async function captureServer<E extends AnalyticsEventName>(
  event: E,
  distinctId: string,
  properties: EventProperties[E],
): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    c.capture({ distinctId, event, properties });
    // Дожимаем отправку (serverless «замораживает» процесс после ответа), но НИКОГДА
    // не ждём дольше FLUSH_TIMEOUT_MS — даже при смене опций SDK основной запрос не
    // повиснет на сети PostHog. .catch на flush — чтобы брошенный по таймауту промис
    // не дал unhandledRejection. Потерянное событие дешевле повисшего сабмита.
    const flushed = c.flush().catch(() => {});
    await Promise.race([
      flushed,
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ]);
  } catch (e) {
    // Телеметрия не имеет права ломать основную операцию (§11 — измерение, не блокер).
    console.error(`captureServer(${event}) failed`, e);
  }
}
