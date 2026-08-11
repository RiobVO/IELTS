import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { sanitizeInlineMapStyle } from "./map-embed-css";

/**
 * Узлы, целиком вырезаемые из захваченной вопрос-панели ДО отправки на клиент.
 * Verbatim-рендер (`QuestionHtml`) реэмитит все атрибуты, а источник может прятать
 * правильный ответ или активный контент в узле, скрытом лишь исходным CSS (который
 * захват не переносит):
 *  - `.qnum`/`.dz-num` — видимые маркеры номера вопроса (шум, слот сам несёт номер);
 *  - `.review-flag`/`.cdi-placeholder` — служебные overlay-элементы;
 *  - `.analysis`/`[data-analysis]` — answer-reveal (Inspera reading) И дашборд
 *    результатов listening: оба несут ПРАВИЛЬНЫЙ ОТВЕТ в тексте, скрытый только
 *    `.analysis{display:none}` — в practice-панели не нужны и опасны;
 *  - любой активный/интерактивный тег (script/style/link/…/form/button).
 */
const LEAK_NODES =
  ".review-flag, .cdi-placeholder, .qnum, .dz-num, .analysis, [data-analysis], " +
  "script, style, link, meta, iframe, object, embed, noscript, form, button";

/**
 * Канон-форма токена для сравнения: нижний регистр без разделителей `-`/`_`
 * (`Correct-Answer`/`correctAnswer`/`ANSWER_KEY` → `correctanswer`/`answerkey`). Даёт
 * устойчивость к регистру и стилю разделителей, оставаясь сравнением ТОКЕН-НА-ТОКЕН,
 * а не подстрокой: `map-answers`→`mapanswers`, `answer-input`→`answerinput`,
 * `answered` не равны ни одному канон-токену (ложных срабатываний нет).
 */
const canonToken = (t: string) => t.toLowerCase().replace(/[-_]/g, "");

/**
 * Reveal-маркеры ответа — источник может прятать ключ не только в санкционированном
 * `[data-analysis]` (Inspera-канон), но и под чужим class/id
 * (`<div class="correct-answer">`/`<div id="correct-answer">Correct answer: …</div>`).
 * Набор храним в канон-форме (см. `canonToken`); сравнение по цельным токенам класс-листа
 * и по значению id, НЕ подстрокой.
 */
const LEAK_MARKER_TOKENS = new Set(
  ["analysis", "correct", "correct-answer", "answer-key", "solution", "reveal"].map(canonToken),
);

/**
 * Токены класса, вычищаемые из ОСТАВШИХСЯ узлов (`stripCapturedLeaks`) — узел прошёл
 * fail-closed детектор, но всё ещё несёт reveal-класс. Сравнение ТОЧНОЕ по канон-форме
 * (тот же `canonToken`, что у `findLeakMarkerToken` — консистентность), НЕ подстрокой:
 * `answer-key`/`correctAnswer` умирают, а легитимные корпус-классы `map-answers`
 * (DAY6 map-mcq grid), `answered`, `answer-input` (канон `mapanswers`/`answered`/
 * `answerinput` ∉ набора) — выживают. Подстрочный regex ошибочно сносил бы их.
 */
const CLASS_LEAK_TOKENS = new Set(
  ["answer", "answers", "answer-key", "correct", "correct-answer", "solution", "key", "reveal", "analysis"].map(
    canonToken,
  ),
);

/**
 * Значение атрибута, несущее ответ прямым текстом (`data-note="Correct answer: B"`,
 * `title="Solution: 42"`) — defense-in-depth поверх вычистки имён/aria: любой ОСТАВШИЙСЯ
 * атрибут источника с таким значением снимается целиком. Наши синтезируемые слот-атрибуты
 * (`SYNTH_SLOT_ATTRS`) исключены — их значения (буква/JSON опций) построены из уже
 * очищенного видимого текста и легитимны.
 */
const ANSWER_VALUE_RE = /correct\s*answer|answer\s*[:=]|solution/i;
// data-map-doc — срcdoc-документ map-embed'а (capture-listening шаг 6): синтезируется
// нами же из фрагмента, прошедшего свой leak-скан + stripMapEmbedLeaks, и стилей,
// прошедших sanitizeEmbedCss; по-атрибутный regex убил бы весь embed из-за легитимного
// CSS-текста внутри. Льгота безопасна ТОЛЬКО вместе с scrubReservedEmbedMarkers на
// входе обоих капчеров: всё, что доносит этот атрибут до финальной гигиены,
// синтезировано нами (Codex-ревью 2026-08-11, блокер 1).
const SYNTH_SLOT_ATTRS = new Set([
  "data-q", "data-qtype", "data-value", "data-options", "data-members", "data-map-doc",
]);

/**
 * Вычистка ЗАРЕЗЕРВИРОВАННЫХ synth-маркеров map-embed'а, пришедших из ИСТОЧНИКА.
 * Обязательный первый шаг обоих капчеров (reading `captureQuestions` и listening
 * `captureListeningPart`): без него исходный файл мог бы принести собственный
 * `.lst-map-embed[data-map-doc]` c answer-reveal внутри — SYNTH-льгота data-map-doc
 * пропустила бы его сквозь stripCapturedLeaks, а MapEmbed отрендерил бы srcdoc
 * прямо клиенту (Codex-ревью 2026-08-11, блокер 1).
 */
export function scrubReservedEmbedMarkers($: CheerioAPI, root: Cheerio<AnyNode>): void {
  root.find(".lst-map-embed").remove();
  root.find("[data-map-doc]").removeAttr("data-map-doc");
}

/**
 * Тripwire на ответ, отрисованный ТЕКСТОМ карты: `<span>Correct answer: B</span>`
 * в нейтральной разметке проходил class/id-детектор и уезжал в srcdoc (ревью
 * 2026-08-11, второй заход). Вызывающий код трактует true как утечку части
 * (fail-closed + onLeak).
 *
 * Паттерн УЖЕ общего ANSWER_VALUE_RE: тот срабатывал на легитимной подписи здания
 * «Solutions Centre» (проба ревью, третий заход) и убивал панель всей части — на
 * карте, где текст = названия зданий и улиц, цена ложного срабатывания выше цены
 * пропуска. Ловим только связки, которые не появляются в подписи объекта.
 *
 * ГРАНИЦА ЧЕСТНО: это тripwire против СЛУЧАЙНОГО reveal-блока в файле (ровно такими
 * были `.analysis`), а не барьер против враждебного автора источника — тот владеет
 * и вопросами, и ключом, и ему не нужен скрытый канал. Порционную обфускацию
 * (`<span>Correct an</span><i>x</i><span>swer</span>`) конкатенация текста не
 * ловит по построению; компенсирующий контроль — запрет типовых способов прятать
 * содержимое в CSS embed'а (map-embed-css.ts), из-за которого вставленный мусор
 * с большой вероятностью виден студенту и «ключ» перестаёт быть ключом.
 *
 * Формулировки — с границами слова (ревью, четвёртый заход: без них паттерн ловил
 * подстроки внутри длинных слов) и с типовыми заголовками забытых reveal-блоков.
 */
const MAP_TEXT_ANSWER_RE =
  /\bcorrect\s+(answers?|options?|choices?|responses?)\b|\banswer\s+keys?\b|\bmodel\s+answers?\b|\bthe\s+answer\s+is\b|\b(answers?|solutions?)\s*[:=]\s*[A-Za-z0-9]/i;

export function fragmentTextCarriesAnswer(nodes: Cheerio<AnyNode>): boolean {
  // Нормализация пробелов/zero-width — разбиение подписи по узлам и переносам
  // не должно скрывать прямую формулировку.
  const text = nodes
    .text()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ");
  return MAP_TEXT_ANSWER_RE.test(text);
}

/**
 * Fail-closed детектор утечки ключа в захваченной панели: возвращает первый найденный
 * подозрительный маркер (class-токен или значение id, в исходном виде — для warning),
 * либо null. Санкционированный `[data-analysis]`-блок и его потомков пропускаем — их
 * штатно вырезает `stripCapturedLeaks` (и read-time route.ts); любой ДРУГОЙ элемент с
 * reveal-маркером = чужой/обфусцированный ключ → вызывающий возвращает пустую панель +
 * warning, вся часть уходит в атомизированный фоллбэк. Тихое удаление (как у
 * `stripCapturedLeaks`) здесь опасно: могло бы вырезать легитимный контент и скрыть
 * проблему, а fail-closed безопасен по построению (атомизация не использует raw HTML).
 * См. блокер B1.
 */
export function findLeakMarkerToken($: CheerioAPI, root: Cheerio<AnyNode>): string | null {
  let token: string | null = null;
  root.find("*").each((_, el) => {
    if (token || !("attribs" in el)) return;
    // Известная легитимная структура — санкционированный Inspera reveal (сам блок + дети).
    if ($(el).closest("[data-analysis]").length > 0) return;
    // class — цельные токены класс-листа; id — единое значение. Оба сверяем в канон-форме.
    const candidates = [...(el.attribs["class"]?.split(/\s+/) ?? []), el.attribs["id"] ?? ""];
    for (const c of candidates) {
      if (c && LEAK_MARKER_TOKENS.has(canonToken(c))) {
        token = c;
        return;
      }
    }
  });
  return token;
}

/**
 * Текст элемента с вырезанными leak-узлами (тот же набор `LEAK_NODES`, что удаляет
 * `stripCapturedLeaks`) — для случаев, когда текст извлекается ДО общей гигиены (синтез
 * drop-опций и подписей в `capture-listening`): источник мог вложить reveal-ответ прямо
 * в чип/подпись (`<span class="analysis">Correct for Q27</span>`), и наивный `.text()`
 * отмыл бы ключ в `data-options`/подпись — тот пережил бы поздний `stripCapturedLeaks`.
 * Работает на КЛОНЕ — исходный DOM не мутирует (узлы ещё нужны последующим шагам).
 */
export function textWithoutLeaks(nodes: Cheerio<AnyNode>): string {
  const clone = nodes.clone();
  clone.find(LEAK_NODES).remove();
  // find() ищет только потомков — сам корневой узел селекции может быть leak-узлом
  // (data-analysis/.analysis прямо на .pc-text/.chip), поэтому корни, матчащие LEAK_NODES,
  // исключаем отдельно (иначе их текст «отмылся» бы в подпись/опцию, пережив общую гигиену).
  return clone.not(LEAK_NODES).text();
}

/**
 * Единая leak-гигиена вопрос-панели: reading (`capture-questions`) и listening
 * (`capture-listening`) делят её, чтобы строгость анти-утечки ключа (BRIEF §6.1)
 * была ИДЕНТИЧНОЙ на обоих путях. Вырезает leak-узлы (`LEAK_NODES`) и вычищает
 * опасные атрибуты каждого оставшегося узла:
 *  - `on*`-обработчики и `style` — снимаем всегда;
 *  - любой атрибут с `correct`/`answer`/`solution` в имени (источник несёт ключ в
 *    `data-correct`/`data-answer` — слоты `data-q/data-qtype/data-value` создаём мы
 *    сами, они чисты);
 *  - `javascript:`/`data:`/`vbscript:` в `href`/`src`/`xlink:href`/`formaction`/
 *    `action` (заодно нейтрализует base64-`data:`-картинки — они не должны раздувать
 *    сохранённый HTML).
 */
export function stripCapturedLeaks($: CheerioAPI, root: Cheerio<AnyNode>): void {
  stripLeaksImpl($, root, { keepStyleAttr: false, extraRemoveSelector: "" });
}

/**
 * Та же строгость для map-фрагмента, уезжающего в srcdoc-embed (`capture-listening`
 * шаг 6): единственное отличие — инлайновый `style` СОХРАНЯЕТСЯ, потому что позиции
 * CSS-рисованной карты живут именно в нём, а рендер идёт в изолированном
 * sandbox-iframe без allow-scripts, где style-атрибут не исполняется и не течёт в
 * app-страницу. Дополнительно выпиливается весь медийно-интерактивный остаток —
 * embed обязан быть чисто статической картинкой.
 */
export function stripMapEmbedLeaks($: CheerioAPI, root: Cheerio<AnyNode>): void {
  stripLeaksImpl($, root, {
    keepStyleAttr: true,
    // Embed — статическая картинка: интерактив и ЛЮБОЙ внешний ресурс (сетевой маяк
    // из img/picture/source — ревью 2026-08-11, MEDIUM) в него не едут.
    extraRemoveSelector: ", input, select, textarea, audio, video, canvas, img, picture, source, image",
  });
  // Атрибуты фрагмента — ПО БЕЛОМУ СПИСКУ (та же модель, что у CSS в map-embed-css.ts).
  // Точечный снос href/src/xlink:href оставлял легаси-носители ресурса: проба ревью
  // провела маяк через `<table background="https://…">`; поимённый блоклист тут снова
  // проигрывает (poster/srcset/data/cite/ping/…), поэтому оставляем только то, что
  // реально рисует карту.
  root.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      const lower = name.toLowerCase();
      if (!MAP_EMBED_ALLOWED_ATTRS.has(lower)) {
        $(el).removeAttr(name);
        continue;
      }
      // SVG-краска допускает paint-server ссылкой (`fill="url(https://…)"`) — сетевой
      // запрос в обход CSS-фильтра (ревью 2026-08-11, четвёртый заход, HIGH).
      if (SVG_PAINT_ATTRS.has(lower) && !SAFE_PAINT_VALUE.test(el.attribs[name] ?? "")) {
        $(el).removeAttr(name);
      }
    }
  });
}

/** Атрибуты SVG, чьё значение может быть ссылкой на paint-server. */
const SVG_PAINT_ATTRS = new Set(["fill", "stroke"]);

/** Простая локальная краска: none/currentColor/имя/#hex/rgb()/hsl() — без url(). */
const SAFE_PAINT_VALUE =
  /^\s*(none|currentcolor|transparent|#[0-9a-f]{3,8}|[a-z]+|(rgba?|hsla?)\([\d\s.,%/-]+\))\s*$/i;

/**
 * Атрибуты, переживающие сборку map-embed'а: класс (по нему матчатся правила),
 * инлайн-позиция, геометрия таблиц и презентационные атрибуты inline-SVG. Всё
 * остальное — включая любой носитель URL — снимается.
 */
const MAP_EMBED_ALLOWED_ATTRS = new Set([
  "class", "style", "colspan", "rowspan",
  // inline-SVG рисунок (компас/дороги): геометрия и заливка, без ссылок
  "viewbox", "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap",
  "stroke-linejoin", "transform", "opacity", "text-anchor", "dominant-baseline",
]);

function stripLeaksImpl(
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  opts: { keepStyleAttr: boolean; extraRemoveSelector: string },
): void {
  root.find(LEAK_NODES + opts.extraRemoveSelector).remove();
  root.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      const value = el.attribs[name];
      if (name === "style" && opts.keepStyleAttr) {
        // Сохраняемый map-embed'ом инлайн-style всё равно проходит свой санитайзер
        // (кастом-свойства/content/url — вон), см. sanitizeInlineMapStyle.
        const cleaned = sanitizeInlineMapStyle(value ?? "");
        if (cleaned) $(el).attr("style", cleaned);
        else $(el).removeAttr("style");
        continue;
      }
      if (
        /^on/i.test(name) ||
        (name === "style" && !opts.keepStyleAttr) ||
        /(correct|answer|solution)/i.test(name) ||
        // aria-label/title/alt источника могут нести ключ прямым текстом значения, а не
        // именем («aria-label="Correct answer: B"»); слоты, что синтезирует сам захват,
        // aria/title/alt НЕ несут (их пишет рендерер QuestionHtml на клиенте) — режем безусловно.
        /^(aria-label|title|alt)$/i.test(name)
      ) {
        $(el).removeAttr(name);
      } else if (
        /^(href|src|xlink:href|formaction|action)$/i.test(name) &&
        /^\s*(javascript|data|vbscript):/i.test(value ?? "")
      ) {
        $(el).removeAttr(name);
      } else if (name !== "style" && !SYNTH_SLOT_ATTRS.has(name) && value != null && ANSWER_VALUE_RE.test(value)) {
        // defense-in-depth: значение любого прочего атрибута источника несёт ответ прямым
        // текстом (data-note="Correct answer: B") — снимаем. Свои слот-атрибуты исключены;
        // сохраняемый map-embed'ом style-атрибут — тоже (CSS-значения проверяет вызывающий
        // код по всему styleText, а не по-атрибутно).
        $(el).removeAttr(name);
      }
    }
    // class может нести ключ ЗНАЧЕНИЕМ токена (class="answer-key"/"correctAnswer"), а не
    // только именем атрибута; findLeakMarkerToken ловит цельные reveal-токены до этого шага,
    // здесь дочищаем по ТОЧНОМУ канон-набору (не подстрокой — иначе легитимный `map-answers`
    // умер бы). Режем лишь матчащие токены, легитимные стили раскладки/слотов сохраняются.
    const cls = el.attribs["class"];
    if (cls) {
      const kept = cls.split(/\s+/).filter((t) => t && !CLASS_LEAK_TOKENS.has(canonToken(t)));
      if (kept.length) $(el).attr("class", kept.join(" "));
      else $(el).removeAttr("class");
    }
  });
}
