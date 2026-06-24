import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, profile } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { scopeRunnerStorage } from "@/lib/import/runner/scope-storage";
import { skinRunnerGate } from "@/lib/import/runner/skin-runner";
import { effectiveTier, meetsTier } from "@/lib/tiers";

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
      .where(eq(contentItem.id, id)),
  ]);

  if (!item?.html) return new Response("Not found", { status: 404 });

  const userTier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  if (!meetsTier(userTier, item.tierRequired)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Заскоупить весь localStorage раннера под user.id (анти-утечка черновика между
  // аккаунтами в одном браузере). Трансформируем КОПИЮ строки — контент в БД не трогаем.
  // Нет точки инжекта → fail-closed (нескоупленный html вернул бы утечку).
  const scoped = scopeRunnerStorage(item.html, user.id);
  if (!scoped) return new Response("Runner unavailable", { status: 500 });
  // bando re-skin аудио-гейта (listening) поверх скоупленного html, на read-time:
  // светлый overlay вместо тёмного оригинала. No-op для reading / тестов без гейта.
  const html = skinRunnerGate(scoped);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // CSP: разрешить инлайн-скрипты файла, аудио из Storage; блокировать навигацию.
      "Content-Security-Policy":
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; media-src https: blob:; frame-ancestors 'self'",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
    },
  });
}
