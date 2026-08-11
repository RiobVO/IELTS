// RUNTIME (read-time) синхронизация ВНУТРЕННЕГО Practice/Mock-выбора runner_html
// с серверным attempt.mode (P0). Раннеры известного семейства несут собственный
// стартовый экран с выбором режима и mid-test переключатель (.mode-switcher) —
// для нас оба чисто косметические: рейтинг/кап ветвятся ТОЛЬКО по attempt.mode
// на сервере. Но рассинхрон (юзер выбрал Practice на ModeStart, внутри кликнул
// Mock) путает, поэтому:
//  (1) прячем mid-test переключатель — режим попытки зафиксирован при создании;
//  (2) авто-стартуем нужный режим НАТИВНЫМ механизмом шаблона: его load-обработчик
//      читает sessionStorage['pendingMode'] и зовёт beginTest(mode) сам (так
//      устроен его собственный retake). Мы лишь кладём значение до load; storage
//      здесь — наш in-memory полифил из <head> (opaque origin), т.е. значение
//      живёт ровно одну загрузку — как и задумано.
// Незнакомый шаблон (нет pendingMode-читателя) → no-op: серверная семантика не
// страдает, внутренний выбор остаётся видимым (двойной вопрос — косметический
// worst-case). Инжект — как в skin-runner; sandbox/CSP не ослабляются
// (script-src 'unsafe-inline' уже разрешён).

export type RunnerMode = "practice" | "mock";

// Маркеры не должны быть подстроками друг друга: includes-проверка одного не
// должна срабатывать от другого.
const CSS_MARK = "bando-mode-force-css";
const JS_MARK = "bando-mode-autostart";

const SWITCHER_HIDE = `<style id="${CSS_MARK}">.mode-switcher{display:none!important}</style>`;

// Значение mode — из закрытого enum, инъекция строки безопасна по построению.
const AUTO_START = (mode: RunnerMode) =>
  `<script id="${JS_MARK}">try{sessionStorage.setItem('pendingMode','${mode}')}catch(e){}</script>`;

/** Шаблон умеет авто-старт по pendingMode (его собственный load-читатель на месте). */
const PENDING_READER = /sessionStorage\.getItem\(['"]pendingMode['"]\)/;

/**
 * Синхронизирует внутренний режим раннера с attempt.mode. Идемпотентно (маркеры);
 * обе части независимы: переключатель прячется и там, где авто-старта нет, и
 * наоборот. Нет ни якорей, ни точек инжекта → возвращает html как есть.
 */
export function forceRunnerMode(html: string, mode: RunnerMode): string {
  let out = html;

  if (
    !out.includes(CSS_MARK) &&
    /class=["'][^"']*mode-switcher/.test(out) &&
    /<\/head>/i.test(out)
  ) {
    out = out.replace(/<\/head>/i, `${SWITCHER_HIDE}</head>`);
  }

  // СТРОГО в <head>: pendingMode-читатель шаблона выполняется сразу в теле его
  // основного скрипта (в конце <body>), а не на load — вставка перед </body>
  // опоздала бы (читатель уже отработал). Перед </head> = после storage-полифила
  // (он встаёт сразу за открывающим <head>) и до любого скрипта тела.
  if (!out.includes(JS_MARK) && PENDING_READER.test(out) && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${AUTO_START(mode)}</head>`);
  }

  return out;
}
