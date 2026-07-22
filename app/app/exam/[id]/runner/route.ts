import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { env } from "@/env";
import { getUser, isAdminProfile } from "@/lib/auth";
import { renderRunnerDocument } from "@/lib/import/runner/render-runner";
import { hasConsumedTrial } from "@/lib/exam/access";
import { isFullCategory, trialAllows } from "@/lib/exam/trial";
import { effectiveTier, meetsTier } from "@/lib/tiers";
import { isUuid } from "@/lib/uuid";

// Origin Supabase Storage — единственный источник аудио раннера (storage.ts getPublicUrl).
// Пиним media-src на него (не blanket https:), чтобы opaque-origin раннер не тянул медиа с
// произвольного хоста. Вычисляется на загрузке модуля (fail-fast, как остальной env).
const SUPABASE_MEDIA_ORIGIN = new URL(env.SUPABASE_URL).origin;

// Отдаёт очищенный runner_html в iframe. Auth — через middleware (/app защищён) +
// явная проверка тут; доступ по tier — inline meetsTier ниже (redirect() из route
// handler невозможен). Контент платный → НЕ публичный Storage. Старт/daily-limit уже
// гейтятся на exam-странице (enforceAccess перед startAttempt); здесь
// defense-in-depth на случай прямого GET /runner.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Malformed id never reaches the uuid-column query (would 500 on cast); 404 instead.
  if (!isUuid(id)) return new Response("Not found", { status: 404 });

  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [[prof], [item], [att]] = await Promise.all([
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil, role: profile.role })
      .from(profile)
      .where(eq(profile.id, user.id)),
    db
      .select({
        tierRequired: contentItem.tierRequired,
        category: contentItem.category,
        html: contentItem.runnerHtml,
        status: contentItem.status,
      })
      .from(contentItem)
      .where(eq(contentItem.id, id)),
    // P0: серверный режим попытки — для синхронизации внутреннего Practice/Mock
    // раннера (forceRunnerMode ниже). Owner-scoped запрос по partial-индексу 0007.
    db
      .select({ mode: attempt.mode })
      .from(attempt)
      .where(
        and(
          eq(attempt.userId, user.id),
          eq(attempt.contentItemId, id),
          eq(attempt.status, "in_progress"),
        ),
      )
      .orderBy(desc(attempt.startedAt))
      .limit(1),
  ]);

  if (!item?.html) return new Response("Not found", { status: 404 });

  // F4 "Sit as student": admin может открыть черновик; для всех остальных — тот же
  // 404, что раньше давал WHERE status='published' (byte-identical для не-админа).
  const isAdmin = isAdminProfile(prof);
  const isDraftPreview = item.status !== "published";
  if (isDraftPreview && !isAdmin) return new Response("Not found", { status: 404 });

  const userTier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  // Tier-гейт + trial-лейн (§4.8), зеркалит enforceAccess: Basic может открыть ОДИН
  // полный тест без апгрейда. Без этого iframe-раннер отдал бы 403 на легитимном
  // trial-старте (страница уже пропустила), и trial сломался бы на середине.
  // F4: черновик ещё не продаётся — тир-гейт неприменим к admin-preview (та же
  // логика, что enforceAccess.adminDraftBypass на странице /app/exam/[id]).
  if (!isDraftPreview && !meetsTier(userTier, item.tierRequired)) {
    const maybeTrial = userTier === "basic" && isFullCategory(item.category);
    const trialConsumed = maybeTrial ? await hasConsumedTrial(user.id, id) : true;
    // C2: trial отдаёт runner-HTML ТОЛЬКО при существующей in_progress-попытке юзера
    // на ЭТОТ item (att). Иначе прямой GET /runner без старта читал бы контент многих
    // full mock, не расходуя trial. Легитимный поток цел: exam page создаёт попытку
    // до загрузки iframe. Для premium/ultra ветка не исполняется (meetsTier пропускает).
    const trialGranted =
      !!att &&
      trialAllows({
        userTier,
        tierRequired: item.tierRequired,
        category: item.category,
        trialConsumed,
      });
    if (!trialGranted) return new Response("Forbidden", { status: 403 });
  }

  // Лимит mock из ?min= (iframe передаёт его сюда). Route доступен прямым GET →
  // defense-in-depth: та же валидация, что на exam-странице. searchParams.get даёт
  // null при отсутствии (у страницы — undefined) → явно ведём его в NaN → null,
  // иначе Number(null)===0 склампилось бы в 5 минут.
  const minParam = new URL(req.url).searchParams.get("min");
  const minRaw = minParam == null ? NaN : Math.round(Number(minParam));
  const minutes = Number.isFinite(minRaw)
    ? Math.min(180, Math.max(5, minRaw))
    : null;
  // Единый read-time рендер (полифил storage → ретаргет bridge → прогресс-мост → re-skin
  // → форс режима попытки → анти-утечка → practice-only аудио-мост). Порядок и mock-выдача
  // байт-в-байт прежние (покрыто render-runner.test.ts). Нет <head> для полифила →
  // fail-closed 500, как раньше. Прямой GET без попытки (att отсутствует) → mode=null →
  // forceRunnerMode пропускается, экзам-страница создаёт attempt до iframe.
  const safe = renderRunnerDocument(item.html, {
    mode: att?.mode ?? null,
    mockMinutes: att?.mode === "mock" ? minutes : null,
  });
  if (!safe) return new Response("Runner unavailable", { status: 500 });

  return new Response(safe, {
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
