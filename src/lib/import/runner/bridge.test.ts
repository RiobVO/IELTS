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
