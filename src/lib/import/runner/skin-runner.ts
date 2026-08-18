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
#playOverlay.play-ov{background:oklch(0.975 0.006 286)!important;color:oklch(0.245 0.014 280)!important;font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif!important}
#playOverlay .hp{font-size:34px!important;width:76px!important;height:76px!important;display:grid!important;place-items:center!important;margin:0 auto!important;background:oklch(0.955 0.030 290)!important;border-radius:22px!important}
#playOverlay .warn{color:oklch(0.245 0.014 280)!important;font-weight:700!important;font-size:1.0625rem!important;line-height:1.55!important;max-width:48ch!important;margin:20px auto 0!important;text-wrap:balance}
#playOverlay .dl-wrap{max-width:440px!important;margin:26px auto 0!important}
#playOverlay .dl-bar{background:oklch(0.962 0.006 288)!important;height:10px!important;border-radius:999px!important;overflow:hidden!important}
#playOverlay .dl-fill,#playOverlay #dlBar{background:oklch(0.585 0.225 292)!important;border-radius:999px!important;transition:width .2s cubic-bezier(0.16,1,0.3,1)!important}
#playOverlay .dl-row{display:flex!important;justify-content:space-between!important;align-items:baseline!important;margin-top:10px!important;color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;font-weight:600!important}
#playOverlay #dlPct{font-family:ui-monospace,'JetBrains Mono','SFMono-Regular',monospace!important;font-weight:700!important;color:oklch(0.50 0.205 292)!important}
#playOverlay .cta{color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;line-height:1.5!important;max-width:46ch!important;margin:22px auto 0!important;text-wrap:pretty}
#playOverlay .play-btn{background:oklch(0.585 0.225 292)!important;color:#fff!important;border:0!important;font-family:'Manrope',system-ui,sans-serif!important;font-weight:800!important;font-size:1rem!important;letter-spacing:-0.01em!important;padding:13px 32px!important;border-radius:14px!important;margin-top:30px!important;box-shadow:0 3px 0 0 oklch(0.50 0.205 292)!important;cursor:pointer!important;transition:transform .15s cubic-bezier(0.16,1,0.3,1),box-shadow .15s,background .15s!important}
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

// RUNTIME (read-time) фикс мобильного горизонтального скролла широких matching-таблиц.
// Симптом (второй published reading — таблица A–I, вопросы 14-19): 9-колоночная
// .matching-table шире мобильного вьюпорта (~479px min-content > ~343px панель вопросов).
// В этом шаблоне таблица лежит ПРЯМО в .question-content (overflow:visible), поэтому её
// переполнение всплывает до .questions-container — а у него overflow-y:auto, что по
// CSS-спеке ДЕЛАЕТ overflow-x вычисляемым в auto → именно он становится горизонтальным
// скроллером. В .questions-container же сидит .question-rubric с инструкцией, поэтому
// свайп по таблице уносит текст «Reading Passage 2 has nine paragraphs» из вьюпорта.
// Фикс: делаем САМУ таблицу собственным горизонтальным скроллером (display:block +
// overflow-x:auto) — её переполнение больше не всплывает наверх, .questions-container не
// скроллится, инструкция стоит на месте, а колонки таблицы доступны свайпом внутри неё.
// Селектор узкий — .matching-table, НЕ .question-content и НЕ table в целом: не трогает
// full-width результат/score-таблицы (<table style="width:100%">) и прочие типы вопросов.
// Только ≤680px (существующий брейкпоинт раннера): на desktop переполнения нет, а
// display:block там сжал бы full-width таблицу до min-content — фикс не нужен и вреден.
// Инъекция перед </head> (после стилей файла → выигрывает по порядку источника; longhand
// overflow-x перекрывает shorthand overflow:hidden таблицы в passage-шаблоне). Гейт на
// наличие .matching-table: без сеток — no-op (listening/шаблоны без таблиц не пачкаем,
// контракт no-op их тестов сохранён). Идемпотентно (маркер), no-op без </head>.
const TABLE_SCROLL_MARK = "bando-mtable-scroll";
const TABLE_SCROLL_STYLE = `<style id="${TABLE_SCROLL_MARK}">@media(max-width:680px){.matching-table{display:block;overflow-x:auto;max-width:100%}}</style>`;

/**
 * Изолирует горизонтальный скролл широких `.matching-table` на самой таблице (мобайл).
 * No-op, если в html нет `.matching-table`, нет `</head>`, или уже пропатчено (маркер).
 */
export function skinRunnerTableScroll(html: string): string {
  if (html.includes(TABLE_SCROLL_MARK)) return html; // уже пропатчено
  if (!/class=["'][^"']*matching-table/.test(html)) return html; // нет широких сеток
  if (!/<\/head>/i.test(html)) return html; // нет безопасной точки инъекции
  return html.replace(/<\/head>/i, `${TABLE_SCROLL_STYLE}</head>`);
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
.bando-brand .bw{font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif!important;font-weight:800!important;font-size:1.25rem!important;letter-spacing:-0.02em!important;color:oklch(0.245 0.014 280)!important}
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
  // Мобильный скролл широких matching-таблиц — ДО brand-раннего-return: у него
  // СВОЙ маркер идемпотентности (bando-mtable-scroll), и уже ребрендированный
  // html (double-skin путь) обязан получить table-CSS (Codex 2026-07-11). Гейт
  // на .matching-table внутри → на шаблонах без таблиц это no-op.
  let out = skinRunnerTableScroll(html);
  if (out.includes("bando-brand-skin")) return out; // уже ребрендировано
  out = out.replace(RE_TELEGRAM, ""); // тег чужого канала в шапке
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

// RUNTIME (read-time) фикс жадной аудио-предзагрузки listening-раннера с download-
// гейтом (#playOverlay). Распознанное семейство держит `<audio preload="auto">` и
// дёргает `audio.load()` сразу на загрузке страницы — браузер тянет ВЕСЬ mp3 из
// Storage, даже если юзер тест не открывал (лишний egress на Free-плане Supabase перед
// стелс-волной ~600 юзеров, BACKLOG OPS-1). Голая замена preload auto→metadata сломала
// бы сам гейт: Play разблокируется только через markAudioReady (canplaythrough /
// buffered>=dur-0.4 / canplay+таймаут) — без явного audio.load() при 'auto' браузер
// вообще не начнёт стриминг, буфер не наберётся, и Play не активируется НИКОГДА.
// Поэтому вместо голой замены — отложенный запуск: preload остаётся 'metadata' до
// первого пользовательского жеста (pointerdown/keydown на document, capture; листенеры
// снимают друг друга после первого срабатывания — ручной once), а по жесту ставим
// 'auto' + load() — то же самое, что раннер делал сразу, просто по требованию. Вся
// остальная машинерия прогресс-бара/гейта не тронута и отработает штатно с момента
// жеста.
// Гейт применимости — распознанное семейство: #playOverlay + inline
// `audio.preload='auto'` + `audio.load()` ВСЕ три сразу. Если якоря есть, но их JS-
// последовательность не смежная (иной незнакомый вариант вёрстки) — патч не применяем
// вовсе, чтобы не оставить html в промежуточном состоянии (атрибут metadata без
// deferred-kick заблокировал бы стрим навсегда). Reading-раннеры и незнакомые
// listening-семейства — no-op байт-в-байт.
const AUDIO_DEFER_MARK = "bando-audio-defer";

// Смежная пара из оригинального раннера: `audio.preload='auto';` сразу за которой
// (после опциональных пробелов/комментариев) идёт `audio.load();`.
const AUDIO_PRELOAD_JS_ANCHOR =
  /audio\.preload\s*=\s*(['"])auto\1\s*;(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*audio\.load\s*\(\s*\)\s*;/;

// ES5-совместимо (var/function) — исполняется в sandbox-iframe раннера без транспиляции.
// Обёрнуто в IIFE, чтобы `bandoAudioKick` не утекал в общий scope чужого скрипта
// раннера (страховка от коллизии имён / strict-mode нюансов чужого файла). `audio`
// внутри IIFE НЕ передаётся параметром — резолвится по замыканию на внешний scope,
// как и в оригинальном инжекте (`audio` уже объявлен раньше в том же script-теге).
// Экспортирована для behavioral-теста (skin-runner.test.ts исполняет этот снипет
// напрямую через `new Function`, без jsdom).
export function audioDeferredKickJs(): string {
  return (
    `/* ${AUDIO_DEFER_MARK}: держим 'metadata' до первого жеста — не тянуть mp3 при открытии страницы */` +
    "(function(){" +
    "audio.preload='metadata';" +
    "function bandoAudioKick(){" +
    "document.removeEventListener('pointerdown',bandoAudioKick,true);" +
    "document.removeEventListener('keydown',bandoAudioKick,true);" +
    "audio.preload='auto';" +
    "audio.load();" +
    "}" +
    "document.addEventListener('pointerdown',bandoAudioKick,true);" +
    "document.addEventListener('keydown',bandoAudioKick,true);" +
    "})();"
  );
}

/**
 * Откладывает старт аудио-стрима listening-раннера до первого пользовательского жеста
 * вместо жадной загрузки на открытии страницы (анти-egress, BACKLOG OPS-1). No-op, если
 * html не несёт распознанного download-гейта (#playOverlay + `audio.preload='auto'` +
 * `audio.load()` все три сразу) или их JS-последовательность не смежная — в этом
 * случае html не трогаем вовсе (частичный патч опаснее no-op: атрибут metadata без
 * deferred-kick заблокировал бы стрим навсегда). Идемпотентно: маркер
 * `bando-audio-defer` — на уже пропатченном html повторный вызов ничего не меняет
 * (смежный якорь на верхнем уровне после первого патча уже не существует, заменён
 * деферред-обработчиком).
 */
export function skinRunnerAudioDefer(html: string): string {
  if (html.includes(AUDIO_DEFER_MARK)) return html; // уже пропатчено
  if (!/id=["']playOverlay["']/.test(html)) return html; // не listening-gate
  if (!/audio\.preload\s*=\s*['"]auto['"]/.test(html)) return html; // не распознанный якорь
  if (!/audio\.load\s*\(\s*\)/.test(html)) return html; // не распознанный якорь

  const patchedJs = html.replace(AUDIO_PRELOAD_JS_ANCHOR, audioDeferredKickJs());
  if (patchedJs === html) return html; // якоря есть, но не смежные — не трогаем

  // preload="auto" → preload="metadata" на ВСЕХ <audio>-тегах (не только #audio) —
  // осознанно по ТЗ: незнакомая вариация может нести несколько <audio>, и все они
  // должны получить metadata, а не только один распознанный id (ревью-предложение
  // сузить до #audio отклонено). Регэксп внутри тега — не задевает другие атрибуты.
  return patchedJs.replace(/<audio\b[^>]*>/gi, (tag) =>
    tag.replace(/preload=(["'])auto\1/gi, 'preload="metadata"'),
  );
}

// RUNTIME (read-time) периодический автосейв-мост iframe → parent (волна E, F2-минимал).
// Раннер живёт в opaque-origin sandbox без allow-same-origin — единственный канал
// наружу уже есть: `parent.postMessage({type:'ielts-submit',...})` из bridge.ts,
// собранный там же `__collect()`. Вместо дублирования селекторов сбора ответов
// (два параллельных набора — reading choose-TWO/drag-token/text и listening
// gap/multi/dropzone, оба хрупкие к правкам bridge.ts) СПЛАЙСИМ новый код ВНУТРЬ
// ТОЙ ЖЕ анонимной IIFE bridge-скрипта, текстовой вставкой прямо перед её
// закрытием — `__collect` там уже объявлен function-scoped и виден по замыканию.
// Отдельный <script>-тег снаружи так не смог бы: IIFE ничего не оставляет в
// window (opaque origin, нет утечки в глобальный scope).
//
// Якорь — точный хвост bridge.ts (READING_BRIDGE/LISTENING_BRIDGE, эти константы
// мы же и генерируем при импорте через sanitizeRunner) литеральной строкой, а не
// позиционно/через </body>: он инвариантен относительно ЛЮБЫХ прочих read-time
// патчей (skinRunner*, forceRunnerMode дописывают СВОИ скрипты в другие места —
// хвост bridge-скрипта не трогают) и относительно 5 семейств исходного runner_html
// (bridge — НАШ код, не контент источника, поэтому его текст идентичен во всех
// рядах, импортированных текущим bridge.ts). Применяется РАНЬШЕ прочих skin*/
// forceRunnerMode в route.ts — до того, как что-то ещё могло дописаться рядом.
// Гейт применимости: наличие СВОЕГО SEND (`type: 'ielts-submit'`) — иначе
// неопознанный/чужой bridge, не трогаем вовсе (defensive, no-op).
const PROGRESS_MARK = "bando-progress-bridge";
const READING_TAIL = "window.showResults = function(){ __send(); };\n})();</script>";
const LISTENING_TAIL = "__hook();\n})();</script>";

// ES5, splice-совместимо со scope bridge.ts (var/function, никаких let/const-коллизий
// с __collect/__send/__hook/__readingMultiFor/__multiFor, объявленными рядом).
// Двойной гейт «не спамить»: (1) __hasAnswers — полностью пустой снапшот не шлём
// вовсе (свежий тест без единого ответа); (2) __lastProgress — не шлём повторно
// тот же снапшот. setInterval(~12с) — сеть/подтверждение независимо от событий;
// debounce(~2с) на change/input — быстрый отклик без спама на каждый keystroke.
const PROGRESS_JS = `
  var __lastProgress = null;
  function __hasAnswers(a){ for (var k in a){ if (a[k] !== '' && a[k] != null) return true; } return false; }
  function __sendProgress(){
    try{
      var ans = __collect();
      if (!__hasAnswers(ans)) return;
      var snap = JSON.stringify(ans);
      if (snap === __lastProgress) return;
      __lastProgress = snap;
      parent.postMessage({ type: 'ielts-progress', answers: ans }, '*');
    }catch(e){}
  }
  var __progressDebounce = null;
  function __scheduleProgress(){
    clearTimeout(__progressDebounce);
    __progressDebounce = setTimeout(__sendProgress, 2000);
  }
  document.addEventListener('change', __scheduleProgress, true);
  document.addEventListener('input', __scheduleProgress, true);
  setInterval(__sendProgress, 12000);
`;

/**
 * Инжектит периодический прогресс-мост (`ielts-progress`) внутрь bridge-IIFE.
 * Идемпотентно (маркер `bando-progress-bridge`). No-op, если нет распознанного
 * SEND (`type: 'ielts-submit'`) или хвост bridge не совпал ни с одним известным
 * вариантом (reading/listening) — незнакомый/уже изменённый bridge не трогаем.
 */
export function injectProgressBridge(html: string): string {
  if (html.includes(PROGRESS_MARK)) return html; // уже пропатчено
  if (!html.includes("type: 'ielts-submit'")) return html; // не распознанный bridge
  const marker = `/* ${PROGRESS_MARK} */`;
  if (html.includes(READING_TAIL)) {
    return html.replace(READING_TAIL, `${marker}${PROGRESS_JS}\n${READING_TAIL}`);
  }
  if (html.includes(LISTENING_TAIL)) {
    return html.replace(LISTENING_TAIL, `${marker}${PROGRESS_JS}\n${LISTENING_TAIL}`);
  }
  return html; // SEND есть, но хвост не распознан — не трогаем (частичный патч опаснее no-op)
}
