// RUNTIME (read-time) синхронизация ВНУТРЕННЕГО Practice/Mock-выбора runner_html
// с серверным attempt.mode (P0). Раннеры известных семейств несут собственный
// стартовый экран выбора режима и mid-test переключатель (.mode-switcher) — для нас
// это косметика: рейтинг/кап ветвятся ТОЛЬКО по attempt.mode на сервере. Но рассинхрон
// (юзер выбрал Practice на ModeStart, кликнул Mock внутри) путает, поэтому авто-стартуем
// нужный режим НАТИВНЫМ механизмом самого шаблона и прячем переключатель.
//
// Два известных семейства (детект-маркеры взаимоисключающие на реальных артефактах):
//  A «pendingMode» — load-читатель sessionStorage['pendingMode'] сам зовёт beginTest;
//                    кладём значение до чтения (в <head>, после storage-полифила).
//  B «mode-card»   — стартовый экран с .mode-card-btn и top-level function beginTest();
//                    pendingMode нет вовсе. Зовём beginTest(mode) напрямую скриптом ПОСЛЕ
//                    главного скрипта шаблона (перед последним </body>), плюс анти-flash
//                    скрытие #startScreen. Гибрид (оба набора маркеров) → строго A.
// Незнакомый шаблон → no-op (fail-open): серверная семантика не страдает, внутренний
// выбор остаётся видимым (двойной вопрос — косметический worst-case).
// Инжект как в skin-runner; sandbox/CSP не ослабляются (script-src 'unsafe-inline' есть).

export type RunnerMode = "practice" | "mock";

// Маркеры инъекций. Требование: ни один не должен быть ПОДСТРОКОЙ другого —
// идемпотентность держится на out.includes(<mark>), ложное срабатывание сломало бы её.
const SWITCHER_MARK = "bando-mode-force-css"; // скрытие mid-test .mode-switcher (обе семьи)
const AUTOSTART_A_MARK = "bando-mode-autostart"; // авто-старт семейства A (pendingMode)
const AUTOSTART_B_MARK = "bando-mode-begintest"; // авто-старт семейства B (beginTest)
const STARTHIDE_B_MARK = "bando-start-hide"; // анти-flash скрытие #startScreen (B)

// Верхняя граница mock-лимита (минуты). Санитация по построению третьего аргумента.
const MAX_MOCK_MINUTES = 480;

const SWITCHER_HIDE = `<style id="${SWITCHER_MARK}">.mode-switcher{display:none!important}</style>`;

// Семейство A: значение mode — из закрытого enum, инъекция строки безопасна.
const AUTO_START_A = (mode: RunnerMode) =>
  `<script id="${AUTOSTART_A_MARK}">try{sessionStorage.setItem('pendingMode','${mode}')}catch(e){}</script>`;

// Семейство B: анти-flash — первый paint 260КБ-документа может случиться до конца body.
const STARTHIDE_B = `<style id="${STARTHIDE_B_MARK}">#startScreen{display:none!important}</style>`;

// Семейство A: load-читатель pendingMode на месте.
const PENDING_READER = /sessionStorage\.getItem\(['"]pendingMode['"]\)/;
// Семейство B: top-level beginTest + карточные кнопки выбора режима.
const BEGINTEST_DEF = /function beginTest\(/;
const MODE_CARD_BTN = /mode-card-btn/;

type Family = "A" | "B" | "unknown";

// Упорядоченные взаимоисключающие предикаты. Приоритет A: гибрид (оба набора маркеров)
// трактуется строго как A — его нативный pendingMode-путь первичен.
function detectFamily(html: string): Family {
  if (PENDING_READER.test(html)) return "A";
  if (BEGINTEST_DEF.test(html) && MODE_CARD_BTN.test(html)) return "B";
  return "unknown";
}

/**
 * Синхронизирует внутренний режим раннера с attempt.mode. Идемпотентно (маркеры).
 * mockMinutes — только семейство B и только mock: целое (0, MAX_MOCK_MINUTES], иначе
 * шаблон возьмёт свой дефолт (3600с). Скрытие .mode-switcher — независимо от семейства.
 */
export function forceRunnerMode(
  html: string,
  mode: RunnerMode,
  mockMinutes?: number | null,
): string {
  let out = html;

  // (0) Скрытие mid-test переключателя — независимо от семейства (как раньше).
  if (
    !out.includes(SWITCHER_MARK) &&
    /class=["'][^"']*mode-switcher/.test(out) &&
    /<\/head>/i.test(out)
  ) {
    out = out.replace(/<\/head>/i, `${SWITCHER_HIDE}</head>`);
  }

  switch (detectFamily(html)) {
    case "A":
      // СТРОГО в <head>: pendingMode-читатель отрабатывает в теле основного скрипта
      // (конец <body>), вставка перед </body> опоздала бы. Перед </head> = после
      // storage-полифила и до любого скрипта тела.
      if (!out.includes(AUTOSTART_A_MARK) && /<\/head>/i.test(out)) {
        out = out.replace(/<\/head>/i, `${AUTO_START_A(mode)}</head>`);
      }
      return out;
    case "B":
      return injectNativeAutoStart(out, mode, mockMinutes);
    default:
      return out;
  }
}

// Семейство B. Связность частей критична: CSS-скрытие #startScreen БЕЗ авто-старта =
// soft-brick (юзер никогда не стартует). Поэтому якорь — </body> под JS: нет его →
// не трогаем НИЧЕГО (байт-в-байт). CSS best-effort поверх: нет <head> — переживём
// вспышку, но не brick.
function injectNativeAutoStart(
  html: string,
  mode: RunnerMode,
  mockMinutes?: number | null,
): string {
  let out = html;

  // lastIndexOf: перед ИМЕННО последним </body> — после главного скрипта шаблона
  // (beginTest/pendingMockLimit уже объявлены) и bridge-скриптов импорта.
  const bodyClose = out.toLowerCase().lastIndexOf("</body>");
  if (bodyClose === -1) return out;

  if (!out.includes(AUTOSTART_B_MARK)) {
    // pendingMockLimit — только mock и только валидные целые минуты; в скрипт уходит
    // String(валидированное*60), никакого сырого ввода. Иначе — дефолт шаблона (3600).
    const limitAssign =
      mode === "mock" &&
      typeof mockMinutes === "number" &&
      Number.isInteger(mockMinutes) &&
      mockMinutes > 0 &&
      mockMinutes <= MAX_MOCK_MINUTES
        ? `pendingMockLimit=${String(mockMinutes * 60)};`
        : "";
    // Inline display:none ДО beginTest — закрывает окно хоткеев '1'/'2' (читают inline
    // style) и делает running-проверки шаблона когерентными.
    const script = `<script id="${AUTOSTART_B_MARK}">try{var s=document.getElementById('startScreen');if(s)s.style.display='none';${limitAssign}beginTest('${mode}')}catch(e){}</script>`;
    out = out.slice(0, bodyClose) + script + out.slice(bodyClose);
  }

  // Анти-flash поверх авто-старта. Без </head> пропускаем (вспышка, не brick).
  if (!out.includes(STARTHIDE_B_MARK) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${STARTHIDE_B}</head>`);
  }

  return out;
}
