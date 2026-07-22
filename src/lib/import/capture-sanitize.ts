import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

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
const SYNTH_SLOT_ATTRS = new Set(["data-q", "data-qtype", "data-value", "data-options"]);

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
  root.find(LEAK_NODES).remove();
  root.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      const value = el.attribs[name];
      if (
        /^on/i.test(name) ||
        name === "style" ||
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
      } else if (!SYNTH_SLOT_ATTRS.has(name) && value != null && ANSWER_VALUE_RE.test(value)) {
        // defense-in-depth: значение любого прочего атрибута источника несёт ответ прямым
        // текстом (data-note="Correct answer: B") — снимаем. Свои слот-атрибуты исключены.
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
