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

// Listening: LISTENING_COLLECT не экспортирован отдельно (только обёрнутый в
// LISTENING_BRIDGE вместе с SEND и submit-hook'ом) — извлекаем его исходник из
// экспортированной константы по стабильной границе: __collect/__multiFor всегда
// заканчиваются прямо перед склеенным SEND, который начинается с "function
// __send(ans){" (bridge.ts). Так тест бьётся именно о реально исполняемый мостовой
// код, а не о ручную копию логики.
function collectListening(html: string): Record<number, string> {
  document.body.innerHTML = html;
  const start = "<script>(function(){".length;
  const end = LISTENING_BRIDGE.indexOf("function __send(ans){");
  const collectSrc = LISTENING_BRIDGE.slice(start, end);
  const fn = new Function("document", `${collectSrc}\n return __collect();`) as (
    d: Document,
  ) => Record<number, string>;
  return fn(document);
}

// Комментарий bridge.ts (LISTENING_COLLECT): "gap → multi(checkbox) → radio →
// dropzone" — ровно 4 механизма. Map labelling (.place-chip[data-q] внутри
// .map-dz[data-letter], см. parse-listening.ts/capture-listening.ts и getUserAnswer
// в самом клиентском файле) сюда НЕ входит: ни один из 4 селекторов __collect его не
// матчит. Не чиним (продуктовый код) — фиксируем фактическое поведение тестом ниже.
const LISTENING_MIXED_DOM = `
  <input class="gap" data-q="1" value="  raindrops  ">
  <input class="gap" data-q="2" value="">
  <div class="mcq multi" data-qs="11,12">
    <label><input type="checkbox" value="A" checked></label>
    <label><input type="checkbox" value="B"></label>
    <label><input type="checkbox" value="C" checked></label>
  </div>
  <label><input type="radio" name="q20" value="B" checked></label>
  <label><input type="radio" name="q20" value="C"></label>
  <label><input type="radio" name="q21" value="A"></label>
  <div class="dropzone" data-q="27" data-value="C"></div>
  <div class="dropzone" data-q="28"></div>
  <div class="map-dz" data-letter="A"><div class="place-chip" data-q="15"></div></div>
`;

describe("LISTENING_BRIDGE.__collect — DOM-уровень (per-механизм)", () => {
  const a = collectListening(LISTENING_MIXED_DOM);

  it("gap: .gap[data-q] value, триммится", () => {
    expect(a[1]).toBe("raindrops");
  });

  it("multi: .mcq.multi[data-qs] чекбоксы — отсортированные буквы раздаются по позиции в группе", () => {
    expect(a[11]).toBe("A"); // первый член группы → checked[0]
    expect(a[12]).toBe("C"); // второй член группы → checked[1]
  });

  it("radio: input[name=qN]:checked", () => {
    expect(a[20]).toBe("B");
  });

  it("dropzone: .dropzone[data-q] data-value", () => {
    expect(a[27]).toBe("C");
  });

  it("незаполненные (пустой gap, radio без выбора, dropzone без data-value, номер без элемента) → ''", () => {
    expect(a[2]).toBe("");
    expect(a[21]).toBe("");
    expect(a[28]).toBe("");
    expect(a[40]).toBe("");
  });

  // Фактическое поведение (не дефект по умолчанию — см. doc-комментарий выше):
  // .place-chip/.map-dz — единственный listening-механизм ответа, у которого нет
  // ветки в __collect. Вопрос падает в общий '' fallback, как «номер без элемента».
  it("map labelling (.place-chip/.map-dz) НЕ распознаётся ни одной веткой __collect — падает в '' fallback", () => {
    expect(a[15]).toBe("");
  });
});
