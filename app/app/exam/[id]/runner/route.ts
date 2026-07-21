import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { env } from "@/env";
import { getUser, isAdminProfile } from "@/lib/auth";
import { retargetBridgeOrigin } from "@/lib/import/runner/bridge";
import { forceRunnerMode } from "@/lib/import/runner/force-mode";
import { polyfillRunnerStorage } from "@/lib/import/runner/runner-storage";
import { stripAnalysisLeak } from "@/lib/import/runner/sanitize-runner";
import {
  skinRunnerGate,
  skinRunnerBrand,
  skinRunnerAudioDefer,
  skinRunnerAudioLabel,
  injectProgressBridge,
} from "@/lib/import/runner/skin-runner";
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
  // F2-минимал: периодический автосейв-мост (ielts-progress) сплайсится ВНУТРЬ bridge-IIFE
  // ДО прочих skin*/forceRunnerMode ниже — они дописывают свои скрипты в другие места
  // документа, но не трогают bridge-хвост, на который завязан якорь injectProgressBridge.
  const withProgress = injectProgressBridge(scoped);
  // bando re-skin на read-time: (1) аудио-гейт (listening) — светлый overlay вместо тёмного;
  // (2) шапка — bando-знак вместо чужого логотипа «IELTS™» + снос чужого telegram-канала;
  // (3) отложенный старт аудио-стрима до первого жеста — анти-egress на Storage
  // (BACKLOG OPS-1: голое открытие страницы больше не тянет весь mp3);
  // (4) текст гейта — «Preparing…»/«Audio ready» вместо «Downloading…»/«Download
  // complete»: на тёплом CF edge-кэше буферизация мгновенная, а старый текст читался
  // как полная перекачка файла заново при каждом открытии.
  // No-op для незнакомых шаблонов.
  const skinned = skinRunnerAudioLabel(
    skinRunnerAudioDefer(skinRunnerBrand(skinRunnerGate(withProgress))),
  );
  // Лимит mock из ?min= (iframe передаёт его сюда). Route доступен прямым GET →
  // defense-in-depth: та же валидация, что на exam-странице. searchParams.get даёт
  // null при отсутствии (у страницы — undefined) → явно ведём его в NaN → null,
  // иначе Number(null)===0 склампилось бы в 5 минут.
  const minParam = new URL(req.url).searchParams.get("min");
  const minRaw = minParam == null ? NaN : Math.round(Number(minParam));
  const minutes = Number.isFinite(minRaw)
    ? Math.min(180, Math.max(5, minRaw))
    : null;
  // P0: внутренний Practice/Mock раннера подчиняется attempt.mode (автовыбор
  // карточки + скрытие mid-test переключателя; для нативного mode-card раннера — ещё
  // и mock-лимит из minutes). Прямой GET без попытки (нет att) — отдаём как есть:
  // экзам-страница всё равно создаёт attempt до iframe.
  const html = att
    ? forceRunnerMode(skinned, att.mode, att.mode === "mock" ? minutes : null)
    : skinned;

  // Read-time анти-утечка: исторический runner_html (импортирован ДО ввода strip'а)
  // несёт Inspera `[data-analysis]` разборы с правильным ответом прямо в DOM (скрыты
  // лишь исходным CSS). Переимпорт как лечение недоступен — RegradeRequiredError при
  // существующих попытках. Вырезаем на выдаче. ПОСЛЕ всех трансформов: их regex-якоря
  // работают по исходным байтам runner_html, а не по cheerio-реэмиссии. string-guard
  // внутри = байт-в-байт no-op для рядов без маркера (listening / non-Inspera reading).
  const safe = stripAnalysisLeak(html);

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
