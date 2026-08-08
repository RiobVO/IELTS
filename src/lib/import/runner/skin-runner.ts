// RUNTIME (read-time) bando re-skin для listening audio-gate (#playOverlay).
// Оригинальный HTML импортированного теста несёт ТЁМНЫЙ overlay (наушники / warn /
// прогресс / Play). Перекрываем его светлой bando-палитрой (violet brand, Jakarta,
// 3D-push Play со state'ами) инжектом <style> ПЕРЕД </head> — после оригинальных
// стилей файла, чтобы override выигрывал по порядку (+ #id-специфичность +
// !important как страховка). Делается на read-time в /runner route (рядом с
// polyfillRunnerStorage), поэтому применяется ко ВСЕМ listening-тестам без переимпорта.
// Трогаем ТОЛЬКО селекторы gate (#playOverlay и его дети) — сам тест-раннер не наш,
// его интерфейс не переопределяем.

// Значения — прямо из app/tokens/colors.css (runner изолирован от наших токенов,
// поэтому встраиваем oklch литералами). Jakarta = шрифт bando UI (Google Fonts).
const GATE_SKIN = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap">
<style id="bando-gate-skin">
#playOverlay.play-ov{background:oklch(0.975 0.006 286)!important;color:oklch(0.245 0.014 280)!important;font-family:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif!important}
#playOverlay .hp{font-size:34px!important;width:76px!important;height:76px!important;display:grid!important;place-items:center!important;margin:0 auto!important;background:oklch(0.955 0.030 290)!important;border-radius:22px!important}
#playOverlay .warn{color:oklch(0.245 0.014 280)!important;font-weight:700!important;font-size:1.0625rem!important;line-height:1.55!important;max-width:48ch!important;margin:20px auto 0!important;text-wrap:balance}
#playOverlay .dl-wrap{max-width:440px!important;margin:26px auto 0!important}
#playOverlay .dl-bar{background:oklch(0.962 0.006 288)!important;height:10px!important;border-radius:999px!important;overflow:hidden!important}
#playOverlay .dl-fill,#playOverlay #dlBar{background:oklch(0.585 0.225 292)!important;border-radius:999px!important;transition:width .2s cubic-bezier(0.16,1,0.3,1)!important}
#playOverlay .dl-row{display:flex!important;justify-content:space-between!important;align-items:baseline!important;margin-top:10px!important;color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;font-weight:600!important}
#playOverlay #dlPct{font-family:ui-monospace,'JetBrains Mono','SFMono-Regular',monospace!important;font-weight:700!important;color:oklch(0.50 0.205 292)!important}
#playOverlay .cta{color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;line-height:1.5!important;max-width:46ch!important;margin:22px auto 0!important;text-wrap:pretty}
#playOverlay .play-btn{background:oklch(0.585 0.225 292)!important;color:#fff!important;border:0!important;font-family:'Plus Jakarta Sans',system-ui,sans-serif!important;font-weight:800!important;font-size:1rem!important;letter-spacing:-0.01em!important;padding:13px 32px!important;border-radius:14px!important;margin-top:30px!important;box-shadow:0 3px 0 0 oklch(0.50 0.205 292)!important;cursor:pointer!important;transition:transform .15s cubic-bezier(0.16,1,0.3,1),box-shadow .15s,background .15s!important}
#playOverlay .play-btn:hover:not(:disabled){background:oklch(0.655 0.215 290)!important}
#playOverlay .play-btn:active:not(:disabled){transform:translateY(3px)!important;box-shadow:0 0 0 0 oklch(0.50 0.205 292)!important}
#playOverlay .play-btn:disabled{background:oklch(0.910 0.008 286)!important;color:oklch(0.740 0.014 288)!important;box-shadow:none!important;cursor:not-allowed!important}
#playOverlay .play-btn .tri{border-left-color:currentColor!important}
@media (prefers-reduced-motion:reduce){#playOverlay .dl-fill,#playOverlay #dlBar,#playOverlay .play-btn{transition:none!important}}
</style>`;

/**
 * Инжектит bando-skin gate'а перед `</head>` (после оригинальных стилей → выигрывает).
 * No-op, если в html нет `#playOverlay` (reading-раннер / тесты без аудио-гейта) или
 * нет `</head>`. Идемпотентно: повторный инжект исключён маркером `bando-gate-skin`.
 */
export function skinRunnerGate(html: string): string {
  if (html.includes("bando-gate-skin")) return html; // уже заскинено
  if (!/id=["']playOverlay["']/.test(html)) return html; // не listening-gate
  if (!/<\/head>/i.test(html)) return html; // нет безопасной точки — не трогаем
  return html.replace(/<\/head>/i, `${GATE_SKIN}</head>`);
}

// RUNTIME (read-time) bando re-brand шапки раннера. Импортированные computer-IELTS
// файлы несут В ШАПКЕ чужой брендинг: картинку-логотип источника (img.brand-logo),
// стилизованный вордмарк «IELTS™» (span.logo) и КЛИКАБЕЛЬНЫЙ чужой telegram-канал
// (a.brand-telegram, напр. t.me/EnjoyListeningTests) — последнее уводит наших
// студентов на сторонний канал прямо из экзамена. Снимаем чужой логотип/бренд и
// канал, ставим bando-знак (1:1 с Logo.tsx). Слово «IELTS» в тексте/title не
// трогаем — это нарицательное имя экзамена; убираем только ЛОГОТИП и чужой трафик.
// Делается на read-time (рядом со skinRunnerGate) → покрывает все runner_html без
// переимпорта. Якорь известного шаблона — span.logo / img.brand-logo; нет якоря →
// no-op (незнакомую шапку не калечим).

// bando-знак из Logo.tsx — три скруглённые полосы. Цвета = токены colors.css
// (--brand=violet-600, --text-primary=slate-900) литералами: runner изолирован от
// наших токенов. Jakarta = шрифт bando UI.
const BRAND_FONT = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap">`;

const BRAND_STYLE = `<style id="bando-brand-skin">
.bando-brand{display:inline-flex!important;align-items:center!important;gap:10px!important;line-height:1!important}
.bando-brand .bm{display:block!important;flex:none!important}
.bando-brand .bm .r1{fill:oklch(0.585 0.225 292)!important}
.bando-brand .bm .r2{fill:oklch(0.245 0.014 280)!important;opacity:.92!important}
.bando-brand .bm .r3{fill:oklch(0.245 0.014 280)!important;opacity:.5!important}
.bando-brand .bw{font-family:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif!important;font-weight:800!important;font-size:1.25rem!important;letter-spacing:-0.02em!important;color:oklch(0.245 0.014 280)!important}
.bando-brand .bw i{font-style:normal!important;color:oklch(0.585 0.225 292)!important}
</style>`;

const BANDO_BRAND = `<span class="bando-brand" aria-label="bando"><svg class="bm" width="30" height="30" viewBox="0 0 64 64" fill="none" role="img" aria-hidden="true"><rect class="r1" x="9" y="18" width="34" height="9" rx="4.5"/><rect class="r2" x="9" y="31" width="46" height="9" rx="4.5"/><rect class="r3" x="9" y="44" width="22" height="9" rx="4.5"/></svg><span class="bw">band<i>o</i></span></span>`;

const RE_TELEGRAM = /<a\b[^>]*class=["'][^"']*brand-telegram[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
// Любой якорь, уводящий в t.me — целиком (иначе остаётся мёртвая ссылка-огрызок).
const RE_TME_ANCHOR = /<a\b[^>]*href=["'][^"']*t\.me\/[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
const RE_LOGO_IMG = /<img\b[^>]*class=["'][^"']*brand-logo[^"']*["'][^>]*>/gi;
// Вордмарк: span.logo (первый источник), span.ielts-logo (CDI) или div.ielts-logo
// (ReadinMarathons/Mock) — QA 2026-07-02. class обязан быть РОВНО (ielts-)logo,
// чтобы обёртка div.header__logo не матчилась.
const RE_LOGO_TEXT = /<(span|div)\b[^>]*class=["'](?:ielts-)?logo["'][^>]*>[\s\S]*?<\/\1>/i;

/**
 * Заменяет чужой брендинг шапки раннера на bando + удаляет чужой telegram-канал.
 * Срез чужого ТРАФИКА (t.me-якоря/URL, CHANNEL-переменные share-карточки) идёт
 * ВСЕГДА — увод студентов в сторонний канал не зависит от вёрстки шапки (QA
 * 2026-07-02: у CDI-файлов нераспознанная шапка уносила t.me на прод нетронутым).
 * Замена ЛОГОТИПА — только на распознанной шапке (span.logo / span.ielts-logo /
 * img.brand-logo): незнакомую вёрстку не калечим.
 * Идемпотентно: ребренд исключён маркером `bando-brand-skin`; повторная
 * трафик-очистка — no-op (резать уже нечего).
 */
export function skinRunnerBrand(html: string): string {
  if (html.includes("bando-brand-skin")) return html; // уже ребрендировано

  let out = html.replace(RE_TELEGRAM, ""); // тег чужого канала в шапке
  out = out.replace(RE_TME_ANCHOR, "");
  // Чужой канал живёт ещё и в JS «share-result card» (CHANNEL/CHANNEL_URL =
  // '@chan'/'t.me/chan') + любых остаточных t.me-ссылках. Вычищаем везде, иначе
  // карточка «поделиться» рекламировала бы чужой канал. В exam-раннере своих
  // t.me-ссылок нет → срезаем любую.
  out = out.replace(/((?:const|let|var)\s+CHANNEL(?:_URL)?\s*=\s*)(["'])[^"']*\2/g, "$1$2$2");
  out = out.replace(/https?:\/\/t\.me\/[A-Za-z0-9_+]+/gi, "");
  out = out.replace(/\bt\.me\/[A-Za-z0-9_+]+/gi, "");

  const hasText = RE_LOGO_TEXT.test(out);
  const hasImg = /class=["'][^"']*brand-logo[^"']*["']/i.test(out);
  if (!hasText && !hasImg) return out; // незнакомая шапка — логотип не трогаем
  if (!/<\/head>/i.test(out)) return out; // нет безопасной точки инжекта

  if (hasText) {
    out = out.replace(RE_LOGO_IMG, ""); // картинку убираем, bando-знак ставим вместо текста
    out = out.replace(RE_LOGO_TEXT, BANDO_BRAND);
  } else {
    out = out.replace(RE_LOGO_IMG, BANDO_BRAND); // вордмарка нет — bando вместо картинки
  }
  return out.replace(/<\/head>/i, `${BRAND_FONT}${BRAND_STYLE}</head>`);
}

/**
 * Import-time guard: что в шапке осталось НЕ вычищено после skinRunnerBrand. Пусто
 * = всё ок (наш логотип встанет, чужого канала нет). Непусто = шапка из НОВОГО
 * источника не распознана нашими якорями → чужой логотип/ссылка просочатся на прод
 * молча; нужна ручная проверка или расширение skinRunnerBrand под новую вёрстку.
 * Гоняется при импорте (admin/бот показывают предупреждение), не на read-time.
 */
export function runnerBrandResidue(rawHtml: string): string[] {
  const skinned = skinRunnerBrand(rawHtml);
  const issues: string[] = [];
  const tme = skinned.match(/t\.me\/[A-Za-z0-9_+]+/gi);
  if (tme) issues.push(`foreign telegram link(s) not stripped: ${[...new Set(tme)].join(", ")}`);
  const hadLogo =
    /class=["'][^"']*brand-logo["']/i.test(rawHtml) || RE_LOGO_TEXT.test(rawHtml);
  if (hadLogo && !skinned.includes("bando-brand")) {
    issues.push("source logo not replaced with bando (header markup unrecognized)");
  }
  return issues;
}
