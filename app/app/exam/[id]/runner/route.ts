import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, profile } from "@/db/schema";
import { env } from "@/env";
import { getUser } from "@/lib/auth";
import { retargetBridgeOrigin } from "@/lib/import/runner/bridge";
import { polyfillRunnerStorage } from "@/lib/import/runner/runner-storage";
import { skinRunnerGate, skinRunnerBrand } from "@/lib/import/runner/skin-runner";
import { effectiveTier, meetsTier } from "@/lib/tiers";

// Origin Supabase Storage — единственный источник аудио раннера (storage.ts getPublicUrl).
// Пиним media-src на него (не blanket https:), чтобы opaque-origin раннер не тянул медиа с
// произвольного хоста. Вычисляется на загрузке модуля (fail-fast, как остальной env).
const SUPABASE_MEDIA_ORIGIN = new URL(env.SUPABASE_URL).origin;

// Отдаёт очищенный runner_html в iframe. Auth — через middleware (/app защищён) +
// явная проверка тут; доступ по tier — inline (gateAccess в actions.ts делает
// redirect(), несовместимый с route handler). Контент платный → НЕ публичный
// Storage. Старт/daily-limit уже гейтятся на странице через ensureAttempt; здесь
// defense-in-depth на случай прямого GET /runner.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [[prof], [item]] = await Promise.all([
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, user.id)),
    db
      .select({ tierRequired: contentItem.tierRequired, html: contentItem.runnerHtml })
      .from(contentItem)
      // Published-only (owner-path bypasses RLS): a draft id -> 404, never served.
      .where(and(eq(contentItem.id, id), eq(contentItem.status, "published"))),
  ]);

  if (!item?.html) return new Response("Not found", { status: 404 });

  const userTier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  if (!meetsTier(userTier, item.tierRequired)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Раннер исполняется в OPAQUE origin (iframe sandbox без allow-same-origin — P0-изоляция):
  // нативный localStorage/sessionStorage там БРОСАЕТ, а reading зовёт его без guard на init →
  // подменяем оба Web-Storage in-memory полифилом (runner-storage.ts). Анти-утечки между
  // аккаунтами больше не нужно: opaque origin не делит персистентное хранилище. Нет <head> →
  // fail-closed (иначе отдали бы раннер, падающий на первом localStorage). Контент в БД не трогаем.
  const polyfilled = polyfillRunnerStorage(item.html);
  if (!polyfilled) return new Response("Runner unavailable", { status: 500 });
  // Legacy-ряды runner_html несут в bridge targetOrigin = window.location.origin (=== "null" в
  // opaque origin → postMessage бросает, сабмит теряется). Точечно ретаргетим на "*".
  const scoped = retargetBridgeOrigin(polyfilled);
  // bando re-skin на read-time: (1) аудио-гейт (listening) — светлый overlay вместо тёмного;
  // (2) шапка — bando-знак вместо чужого логотипа «IELTS™» + снос чужого telegram-канала.
  // No-op для незнакомых шаблонов.
  const html = skinRunnerBrand(skinRunnerGate(scoped));

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // CSP (defense-in-depth поверх opaque-origin sandbox): deny-by-default. Раннеру нужны
      // только инлайн-скрипты/стили (без 'unsafe-eval' — фикстуры eval не используют), внешние
      // стили/шрифты FontAwesome + Google Fonts, картинки data/blob и аудио из нашего Storage.
      // connect-src 'none' блокирует fetch/XHR/beacon — главный анти-эксфил-винт (раннер
      // считает прогресс аудио из нативного буфера <audio>, сети не требует).
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
        "font-src https://cdnjs.cloudflare.com https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        `media-src ${SUPABASE_MEDIA_ORIGIN} blob:`,
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
    },
  });
}
