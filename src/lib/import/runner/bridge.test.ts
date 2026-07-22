// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { READING_BRIDGE, LISTENING_BRIDGE, READING_COLLECT, retargetBridgeOrigin } from "./bridge";

// Форма SEND, запечённая в runner_html, импортированные ДО P0-изоляции (legacy-ряды БД).
const LEGACY_SEND =
  "function __send(ans){ try{ parent.postMessage({ type: 'ielts-submit', answers: ans || __collect() }, window.location.origin); }catch(e){} }";

describe("retargetBridgeOrigin", () => {
  it("переписывает legacy targetOrigin window.location.origin → '*'", () => {
    const out = retargetBridgeOrigin(LEGACY_SEND);
    expect(out).toContain("}, '*');");
    expect(out).not.toContain("window.location.origin");
  });

  it("no-op для новых рядов — SEND уже эмитит '*' (идемпотентно)", () => {
    expect(retargetBridgeOrigin(READING_BRIDGE)).toBe(READING_BRIDGE);
    expect(retargetBridgeOrigin(LISTENING_BRIDGE)).toBe(LISTENING_BRIDGE);
  });

  it("трогает только postMessage ielts-submit, не любой window.location.origin", () => {
    const unrelated = "var u = window.location.origin + '/cb';";
    expect(retargetBridgeOrigin(unrelated)).toBe(unrelated);
  });

  it("переписывает SEND даже в окружении прочего кода с window.location.origin", () => {
    const mixed = `var base = window.location.origin;\n${LEGACY_SEND}`;
    const out = retargetBridgeOrigin(mixed);
    expect(out).toContain("var base = window.location.origin;"); // прочий код цел
    expect(out).toContain("}, '*');"); // SEND переписан
    expect(out.match(/window\.location\.origin/g)?.length).toBe(1);
  });
});

// #7: reading bridge собирает чекбокс-группы (choose TWO/THREE) по [data-mcq-group].
describe("READING_BRIDGE — checkbox-group collector (#7)", () => {
  it("несёт __readingMultiFor и селектор data-mcq-group", () => {
    expect(READING_BRIDGE).toContain("__readingMultiFor");
    expect(READING_BRIDGE).toContain("data-mcq-group");
    expect(READING_BRIDGE).toContain('input[type="checkbox"]');
  });
});

// DOM-уровень: исполняем инжектируемый READING_COLLECT в jsdom и вызываем __collect.
// new Function даёт sloppy-scope, куда хойстятся function-декларации __readingMultiFor
// и __collect; document прокидываем параметром (мост в раннере читает глобальный document).
function collect(html: string): Record<number, string> {
  document.body.innerHTML = html;
  const fn = new Function("document", `${READING_COLLECT}\n return __collect();`) as (
    d: Document,
  ) => Record<number, string>;
  return fn(document);
}

// Обе конвенции разом: Inspera (heading/ending-токены в #drop-qN, matching-radio,
// голый text-input БЕЗ .inspera-input-text, mcq-group) + legacy (.dd-blank .drag-token).
const MIXED_DOM = `
  <div class="heading-drop" id="drop-q5" data-q="5"><div class="heading-token" data-heading="ii">ii Books as rare objects</div></div>
  <div class="heading-drop" id="drop-q6" data-q="6"><span class="placeholder">6</span></div>
  <div class="ending-drop" id="drop-q13" data-q="13"><div class="ending-token" data-ending="C">C keep a reserve of water</div></div>
  <div class="ending-drop" id="drop-q14" data-q="14"><span class="placeholder">A&ndash;D</span></div>
  <label><input type="radio" name="q1" value="TRUE" checked><span>TRUE</span></label>
  <label><input type="radio" name="q1" value="FALSE"><span>FALSE</span></label>
  <label><input type="radio" name="q2" value="TRUE"><span>TRUE</span></label>
  <label><input type="radio" name="q2" value="FALSE"><span>FALSE</span></label>
  <input type="text" name="q3" value="  lanterns  ">
  <input type="text" name="q9" value="">
  <div data-mcq-group="17-18"><input type="checkbox" value="C" checked><input type="checkbox" value="A" checked><input type="checkbox" value="B"></div>
  <span class="dd-blank" data-q="20"><span class="drag-token" data-value="Paris"></span></span>
  <span class="dd-blank" data-q="21"></span>
`;

describe("READING_COLLECT.__collect — DOM-уровень (Inspera drag-drop + legacy)", () => {
  const a = collect(MIXED_DOM);

  it("собирает heading-токены Inspera (#drop-qN .heading-token → data-heading)", () => {
    expect(a[5]).toBe("ii");
  });

  it("собирает sentence-ending-токены Inspera (#drop-qN .ending-token → data-ending)", () => {
    expect(a[13]).toBe("C");
  });

  it("собирает голый text-input БЕЗ класса .inspera-input-text и триммит", () => {
    expect(a[3]).toBe("lanterns");
  });

  it("собирает radio :checked", () => {
    expect(a[1]).toBe("TRUE");
  });

  it("собирает checkbox-группу mcq (сортировка + comma-join, одинаково всем членам)", () => {
    expect(a[17]).toBe("A,C");
    expect(a[18]).toBe("A,C");
  });

  it("собирает legacy .dd-blank .drag-token", () => {
    expect(a[20]).toBe("Paris");
  });

  it("незаполненные (heading/ending-плейсхолдер, radio без выбора, пустой input, пустой dd-blank) → ''", () => {
    expect(a[6]).toBe("");
    expect(a[14]).toBe("");
    expect(a[2]).toBe("");
    expect(a[9]).toBe("");
    expect(a[21]).toBe("");
    expect(a[40]).toBe("");
  });

  it("не подхватывает mcq-group чекбоксы как одиночный text-fallback", () => {
    // члены группы отдают полный сет, а не '' и не значение одного чекбокса
    expect(a[17]).not.toBe("");
    expect(a[17]).toContain(",");
  });
});

// Listening-мост: __collect/__multiFor листенинга — приватные функции внутри IIFE
// LISTENING_BRIDGE (в отличие от READING_COLLECT они не экспортируются отдельно).
// Извлекаем их исходник ИЗ уже экспортированной строки (единый источник правды — не
// дублируем логику вручную), обрезая на границе с SEND (маркер стабилен: SEND всегда
// начинается с "function __send"). Сниппеты смоделированы по разметке golden-фикстуры
// (src/lib/import/runner/fixtures/listening-client.html).
function collectListening(html: string): Record<number, string> {
  document.body.innerHTML = html;
  const start = LISTENING_BRIDGE.indexOf("(function(){") + "(function(){".length;
  const end = LISTENING_BRIDGE.indexOf("function __send(");
  const src = LISTENING_BRIDGE.slice(start, end);
  const fn = new Function("document", `${src}\n return __collect();`) as (
    d: Document,
  ) => Record<number, string>;
  return fn(document);
}

describe("LISTENING_BRIDGE.__collect — DOM-уровень (gap / radio / dropzone / choose-TWO)", () => {
  // Part 1 golden-фикстуры: input.gap[data-q] в табличной ячейке.
  it(".gap[data-q] → триммленное значение инпута", () => {
    const a = collectListening(`<input class="gap" data-q="1" value="  pizza  ">`);
    expect(a[1]).toBe("pizza");
  });

  it(".gap[data-q] незаполненный → ''", () => {
    const a = collectListening(`<input class="gap" data-q="1" value="">`);
    expect(a[1]).toBe("");
  });

  // Одиночный radio-выбор через голый input[name=qN] (общий с reading-мостом путь;
  // golden-фикстура его не несёт, но __collect его поддерживает так же, как reading).
  it("одиночный radio :checked → value", () => {
    const a = collectListening(
      `<div class="mcq" data-q="2">
        <label><input type="radio" name="q2" value="A"></label>
        <label><input type="radio" name="q2" value="B" checked></label>
      </div>`,
    );
    expect(a[2]).toBe("B");
  });

  it("radio без выбора → ''", () => {
    const a = collectListening(
      `<div class="mcq" data-q="2">
        <label><input type="radio" name="q2" value="A"></label>
        <label><input type="radio" name="q2" value="B"></label>
      </div>`,
    );
    expect(a[2]).toBe("");
  });

  // Part 3 golden-фикстуры: .dropzone[data-q] с чипом — рантайм проставляет
  // data-value = буква чипа при драге (dz.dataset.value = chip.dataset.letter).
  it(".dropzone[data-q] с брошенным чипом → data-value", () => {
    const a = collectListening(`<div class="dropzone" data-q="27" data-value="C"></div>`);
    expect(a[27]).toBe("C");
  });

  it(".dropzone[data-q] без чипа (нет data-value) → ''", () => {
    const a = collectListening(`<div class="dropzone" data-q="27"></div>`);
    expect(a[27]).toBe("");
  });

  // Part 2/3 golden-фикстуры: choose-TWO — чекбоксы БЕЗ name, сгруппированные
  // .mcq.multi[data-qs="11,12"]; выбранные буквы СОРТИРУЮТСЯ и раздаются по позиции
  // в data-qs (а не по порядку в DOM) — реальное поведение __multiFor.
  it(".mcq.multi[data-qs] чекбоксы → отсортированные буквы раздаются по позиции в data-qs", () => {
    const a = collectListening(
      `<div class="mcq multi" data-qs="11,12">
        <label><input type="checkbox" value="A"></label>
        <label><input type="checkbox" value="B" checked></label>
        <label><input type="checkbox" value="C"></label>
        <label><input type="checkbox" value="D"></label>
        <label><input type="checkbox" value="E" checked></label>
      </div>`,
    );
    // checked = [B, E], уже отсортированы; qs.indexOf(11)=0→B, qs.indexOf(12)=1→E
    expect(a[11]).toBe("B");
    expect(a[12]).toBe("E");
  });

  it(".mcq.multi[data-qs] — незаполненная позиция группы → ''", () => {
    const a = collectListening(
      `<div class="mcq multi" data-qs="21,22">
        <label><input type="checkbox" value="A" checked></label>
        <label><input type="checkbox" value="B"></label>
      </div>`,
    );
    expect(a[21]).toBe("A");
    expect(a[22]).toBe(""); // второй позиции нечего отдать — checked всего один
  });

  it("незаполненные вопросы вне любого механизма → ''", () => {
    const a = collectListening(`<input class="gap" data-q="1" value="x">`);
    expect(a[40]).toBe("");
  });

  // Part 2 golden-фикстуры: map/plan labelling — .place-chip[data-q], реально
  // (drop-обработчик клиентского файла) реродительcя ВНУТРЬ .map-dz[data-letter]
  // при успешном drop'е; ответ — буква зоны (зеркалит getUserAnswer источника).
  it(".place-chip[data-q] размещён на .map-dz зоне → буква зоны", () => {
    const a = collectListening(
      `<div class="map-dz" data-letter="F"><div class="place-chip" data-q="15"></div></div>`,
    );
    expect(a[15]).toBe("F");
  });

  it(".place-chip[data-q] не размещён (вне .map-dz, ещё в банке) → ''", () => {
    const a = collectListening(
      `<div class="place-bank"><div class="place-chip" data-q="16"></div></div>`,
    );
    expect(a[16]).toBe("");
  });
});
