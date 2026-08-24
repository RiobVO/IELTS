import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { captureListeningPart } from "./capture-listening";
import { questionsHtmlCoversAll } from "../exam/question-html-coverage";

// captureListeningPart принимает outerHTML одной `.part` и опускает listening-механизмы
// ответа к канонической структуре `.q-slot[data-q]` (та же, что у reading-захвата и что
// понимают coverage-гейт + QuestionHtml). Возвращает ВНУТРЕННИЙ HTML части.
const part = (inner: string, cls = "part") => `<div class="${cls}" data-part="1">${inner}</div>`;

describe("captureListeningPart — completion gaps", () => {
  it("input.gap[data-q] → text-слот, окружающий текст сохранён", () => {
    const out = captureListeningPart(
      part(
        `<div class="form-box"><div class="form-row">Name: <input class="gap" data-q="1" aria-label="Question 1"></div>` +
          `<div class="form-row">Date: <input class="gap sm" data-q="2"></div></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [1, 2])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="text"][data-q="1"]').length).toBe(1);
    expect($('.q-slot[data-qtype="text"][data-q="2"]').length).toBe(1);
    expect(out).toContain("Name:");
    expect(out).not.toContain("<input");
  });
});

describe("captureListeningPart — single MCQ / map-mcq", () => {
  it(".mcq[data-q] radio-опции → radio-слоты с value, номер с блока", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq" data-q="11"><div class="stem"><span class="qnum">11</span> Question?</div>` +
          `<label><input type="radio" name="q11" value="A"><span class="opt-letter">A</span> alpha</label>` +
          `<label><input type="radio" name="q11" value="B"><span class="opt-letter">B</span> beta</label></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [11])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="radio"][data-q="11"]').length).toBe(2);
    expect($('.q-slot[data-qtype="radio"][data-value="A"]').length).toBe(1);
    // .qnum (видимый номер) вычищен гигиеной, текст опции сохранён
    expect(out).not.toMatch(/<span class="qnum"/);
    expect(out).toContain("alpha");
  });

  it("map-mcq (класс 'mcq map-mcq') обрабатывается как обычный MCQ", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq map-mcq" data-q="12"><div class="stem"><span class="opt-text">Building</span></div>` +
          `<label><input type="radio" name="q12" value="A"><span class="opt-letter">A</span></label>` +
          `<label><input type="radio" name="q12" value="B"><span class="opt-letter">B</span></label></div>`,
      ),
    );
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="radio"][data-q="12"]').length).toBe(2);
  });

  it("MCQ-блок без radio-опций → fail-closed", () => {
    const out = captureListeningPart(part(`<div class="mcq" data-q="11"><div class="stem">Q</div></div>`));
    expect(out).toBe("");
  });

  it("radio с пустым value → fail-closed (незаполнимый вопрос, coverage прошёл бы по номеру)", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq" data-q="11"><div class="stem">Q</div>` +
          `<label><input type="radio" name="q11" value=""><span>A</span></label>` +
          `<label><input type="radio" name="q11" value="B"><span>B</span></label></div>`,
      ),
    );
    expect(out).toBe("");
  });
});

describe("captureListeningPart — choose-TWO/THREE (.mcq.multi[data-qs])", () => {
  const multi = (qs: string, letters: string[]) =>
    `<div class="mcq multi" data-qs="${qs}"><div class="stem"><span class="qnum">21&ndash;22</span> Pick TWO</div>` +
    letters.map((v) => `<label><input type="checkbox" value="${v}"><span class="opt-letter">${v}</span> opt ${v}</label>`).join("") +
    `</div>`;

  it("checkbox-слоты на первом номере + group-anchor остальным членам", () => {
    const out = captureListeningPart(part(multi("21,22", ["A", "B", "C", "D", "E"])));
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [21, 22])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="checkbox"][data-q="21"]').length).toBe(5);
    expect($('.q-slot[data-qtype="checkbox"][data-q="22"]').length).toBe(0);
    expect($('.q-slot[data-qtype="group-anchor"][data-q="22"]').length).toBe(1);
  });

  it("три члена (choose-THREE) — все покрыты", () => {
    const out = captureListeningPart(part(multi("18,19,20", ["A", "B", "C", "D"])));
    expect(questionsHtmlCoversAll(out, [18, 19, 20])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="group-anchor"]').length).toBe(2);
  });

  it("<2 членов в data-qs → fail-closed", () => {
    expect(captureListeningPart(part(multi("21", ["A", "B"])))).toBe("");
  });

  it("пустой/дублирующийся value чекбокса → fail-closed", () => {
    expect(captureListeningPart(part(multi("21,22", ["A", ""])))).toBe("");
    expect(captureListeningPart(part(multi("21,22", ["A", "A"])))).toBe("");
  });

  it("нет чекбоксов → fail-closed", () => {
    expect(captureListeningPart(part(`<div class="mcq multi" data-qs="21,22"></div>`))).toBe("");
  });

  it("номер группы пересекается с gap → fail-closed", () => {
    const out = captureListeningPart(
      part(multi("21,22", ["A", "B"]) + `<input class="gap" data-q="21">`),
    );
    expect(out).toBe("");
  });
});

describe("captureListeningPart — matching (.dropzone[data-q])", () => {
  const ddWrap = (rows: [number, string][], chips: [string, string][]) =>
    `<div class="dd-wrap"><div class="dd-col-q">` +
    rows
      .map(
        ([n, text]) =>
          `<div class="match-row"><div class="mtext">${text}</div><div class="dropzone" data-q="${n}" data-num="${n}"><span class="dz-num">${n}</span></div></div>`,
      )
      .join("") +
    `</div><div class="dd-col-o"><div class="chip-bank" data-reuse="1">` +
    chips.map(([v, l]) => `<div class="chip" draggable="true" data-letter="${v}">${l}</div>`).join("") +
    `</div></div></div>`;

  it(".dropzone → drop-слот; опции — из .chip-bank ближайшего .dd-wrap", () => {
    const out = captureListeningPart(
      part(
        ddWrap(
          [
            [17, "Prepping"],
            [18, "Continuity"],
          ],
          [
            ["A", "well-organised"],
            ["B", "flexible"],
          ],
        ),
      ),
    );
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [17, 18])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="drop"][data-q="17"]').length).toBe(1);
    // опции = канон-буквы банка
    const opts = JSON.parse($('.q-slot[data-q="17"]').attr("data-options") ?? "[]");
    expect(opts).toEqual([
      { v: "A", label: "well-organised" },
      { v: "B", label: "flexible" },
    ]);
    // statement сохранён, dropzone/dz-num/draggable вычищены
    expect(out).toContain("Prepping");
    expect(out).not.toContain("dropzone");
    expect(out).not.toContain("dz-num");
    expect(out).not.toContain("draggable");
  });

  it("две группы matching — банк скоупится per .dd-wrap (без смешивания)", () => {
    const out = captureListeningPart(
      part(
        ddWrap([[13, "X"]], [["A", "first"]]) + ddWrap([[14, "Y"]], [["B", "second"]]),
      ),
    );
    const $ = load(out, null, false);
    const o13 = JSON.parse($('.q-slot[data-q="13"]').attr("data-options") ?? "[]");
    const o14 = JSON.parse($('.q-slot[data-q="14"]').attr("data-options") ?? "[]");
    expect(o13).toEqual([{ v: "A", label: "first" }]);
    expect(o14).toEqual([{ v: "B", label: "second" }]);
  });

  it("пустой банк чипов → fail-closed", () => {
    const out = captureListeningPart(
      part(
        `<div class="dd-wrap"><div class="match-row"><div class="mtext">X</div>` +
          `<div class="dropzone" data-q="17"></div></div></div>`,
      ),
    );
    expect(out).toBe("");
  });

  it("пустая буква чипа (data-letter='') → fail-closed", () => {
    const out = captureListeningPart(
      part(
        `<div class="dd-wrap"><div class="match-row"><div class="mtext">X</div>` +
          `<div class="dropzone" data-q="17"></div></div>` +
          `<div class="chip-bank"><div class="chip" data-letter="">orphan</div></div></div>`,
      ),
    );
    expect(out).toBe("");
  });

  it("вложенный в чип reveal (.analysis[data-analysis]) НЕ отмывается в label data-options (B1)", () => {
    // findLeakMarkerToken пропускает [data-analysis] (санкционированный) — панель НЕ фейлится,
    // поэтому синтез data-options реально исполняется; без textWithoutLeaks текст ключа осел бы
    // в JSON опции ДО общей гигиены и пережил бы её.
    const out = captureListeningPart(
      part(
        `<div class="dd-wrap"><div class="match-row"><div class="mtext">Prepping</div>` +
          `<div class="dropzone" data-q="17"></div></div>` +
          `<div class="chip-bank"><div class="chip" data-letter="A">well-organised` +
          `<span class="analysis" data-analysis="1">Correct for Q17</span></div></div></div>`,
      ),
    );
    expect(out).not.toBe("");
    const $ = load(out, null, false);
    const opts = JSON.parse($('.q-slot[data-q="17"]').attr("data-options") ?? "[]");
    expect(opts).toEqual([{ v: "A", label: "well-organised" }]);
    expect(out).not.toMatch(/Correct for Q17/);
    expect(out).not.toMatch(/analysis/i);
  });

  it("data-analysis ПРЯМО на .chip (корневой leak-узел) — текст ключа не в label (B1 root)", () => {
    // textWithoutLeaks чистит потомков find()'ом; корневой .chip с data-analysis должен
    // исключаться отдельно (.not) — иначе его текст отмылся бы в option-label.
    const out = captureListeningPart(
      part(
        `<div class="dd-wrap"><div class="match-row"><div class="mtext">Prepping</div>` +
          `<div class="dropzone" data-q="17"></div></div>` +
          `<div class="chip-bank"><div class="chip" data-letter="A">safe</div>` +
          `<div class="chip" data-letter="B" data-analysis="1">Correct-for-Q17</div></div></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(out).not.toMatch(/Correct-for-Q17/);
  });

  it("чип БЕЗ data-letter → fail-closed (обход fail-close отсутствующим атрибутом)", () => {
    const out = captureListeningPart(
      part(
        `<div class="dd-wrap"><div class="match-row"><div class="mtext">X</div>` +
          `<div class="dropzone" data-q="17"></div></div>` +
          `<div class="chip-bank"><div class="chip" data-letter="A">a</div>` +
          `<div class="chip">no-letter</div></div></div>`,
      ),
    );
    expect(out).toBe("");
  });
});

describe("captureListeningPart — map labelling (.place-chip[data-q])", () => {
  const mapPart = (chips: [number, string][], zones: [string, string][]) =>
    part(
      `<div class="map-dd"><div class="map-stage"><img class="map-image" src="data:image/jpeg;base64,AAAA" alt="plan">` +
        zones.map(([v, l]) => `<div class="map-dz" data-letter="${v}" style="left:10%" aria-label="${l}"></div>`).join("") +
        `</div><div class="place-bank-col"><div class="place-bank">` +
        chips
          .map(([n, t]) => `<div class="place-chip" draggable="true" data-q="${n}"><span class="pc-num">${n}</span><span class="pc-text">${t}</span></div>`)
          .join("") +
        `</div></div></div>`,
    );

  it(".place-chip → строка с drop-слотом; карта-картинка вырезана; подпись опции = буква (не aria-label)", () => {
    const out = captureListeningPart(
      mapPart(
        [
          [15, "Exhibition"],
          [16, "Cafe"],
        ],
        [
          ["A", "Building A"],
          ["B", "Building B"],
        ],
      ),
    );
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [15, 16])).toBe(true);
    const $ = load(out, null, false);
    expect($('.q-slot[data-qtype="drop"][data-q="15"]').length).toBe(1);
    const opts = JSON.parse($('.q-slot[data-q="15"]').attr("data-options") ?? "[]");
    // Зоны-точки карты без видимого текста → подпись падает на саму букву; aria-label
    // источника («Building A») в синтез НЕ копируется (мог бы нести ключ).
    expect(opts).toEqual([
      { v: "A", label: "A" },
      { v: "B", label: "B" },
    ]);
    expect(out).not.toContain("Building A");
    // подпись места сохранена, base64-картинка и .map-dz вырезаны
    expect(out).toContain("Exhibition");
    expect(out).not.toMatch(/data:image/);
    expect(out).not.toContain("map-dz");
    expect(out).not.toContain("place-chip");
  });

  it("aria-label зоны с ключом НЕ попадает в option-label (синтез из видимого текста)", () => {
    const out = captureListeningPart(
      mapPart([[15, "Exhibition"]], [["A", "Correct answer: A"], ["B", "Building B"]]),
    );
    expect(out).not.toBe("");
    const $ = load(out, null, false);
    const opts = JSON.parse($('.q-slot[data-q="15"]').attr("data-options") ?? "[]");
    expect(opts).toEqual([
      { v: "A", label: "A" },
      { v: "B", label: "B" },
    ]);
    expect(out).not.toMatch(/Correct answer/i);
  });

  it("data-analysis ПРЯМО на .pc-text (корневой leak-узел) — текст ключа не в подписи (B1 root)", () => {
    const out = captureListeningPart(
      part(
        `<div class="map-dd"><div class="map-stage">` +
          `<div class="map-dz" data-letter="A" aria-label="A"></div></div>` +
          `<div class="place-bank"><div class="place-chip" data-q="15">` +
          `<span class="pc-num">15</span><span class="pc-text" data-analysis="1">Correct-for-Q15</span></div></div></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(out).not.toMatch(/Correct-for-Q15/);
  });

  it("зона без data-letter → fail-closed (обход fail-close отсутствующим атрибутом)", () => {
    const out = captureListeningPart(
      part(
        `<div class="map-dd"><div class="map-stage">` +
          `<div class="map-dz" data-letter="A" aria-label="A"></div>` +
          `<div class="map-dz" aria-label="B"></div></div>` + // без data-letter
          `<div class="place-bank"><div class="place-chip" data-q="15"><span class="pc-text">X</span></div></div></div>`,
      ),
    );
    expect(out).toBe("");
  });

  it("нет зон карты → fail-closed", () => {
    const out = captureListeningPart(
      part(`<div class="place-chip" data-q="15"><span class="pc-text">X</span></div>`),
    );
    expect(out).toBe("");
  });
});

describe("captureListeningPart — leak-гигиена", () => {
  it("вырезает script/.analysis/answer-атрибуты/on*-обработчики", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq" data-q="1" data-correct="A" onclick="steal()"><div class="stem">Q</div>` +
          `<label><input type="radio" name="q1" value="A">A</label></div>` +
          `<div class="analysis" data-analysis="1">The answer is A</div>` +
          `<script>const KEY={"1":"A"};</script>`,
      ),
    );
    expect(out).not.toBe("");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/analysis/i);
    expect(out).not.toMatch(/The answer is A/);
    expect(out).not.toMatch(/data-correct/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/KEY/);
  });

  it("part-banner (дубль body_html) вырезан", () => {
    const out = captureListeningPart(
      part(`<div class="part-banner">Part 1 banner</div><input class="gap" data-q="1">`),
    );
    expect(out).not.toContain("Part 1 banner");
    expect(questionsHtmlCoversAll(out, [1])).toBe(true);
  });

  it("вырезает aria-label/title источника (ключ в ЗНАЧЕНИИ атрибута, не имени)", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq" data-q="1"><div class="stem" title="Correct answer: A" aria-label="The answer is A">Q</div>` +
          `<label><input type="radio" name="q1" value="A"><span class="opt-letter">A</span> alpha</label></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(out).not.toMatch(/aria-label/i);
    expect(out).not.toMatch(/title=/i);
    expect(out).not.toMatch(/Correct answer/i);
    expect(out).not.toMatch(/The answer is A/);
    expect(out).toContain("alpha"); // легитимный видимый текст цел
  });

  it("канон-точная вычистка класса: легитимный .map-answers (DAY6 map-mcq grid) СОХРАНЯЕТСЯ", () => {
    // Подстрочный regex снёс бы 'map-answers'/'answered'/'answer-input'; канон-точное
    // сравнение (mapanswers ∉ набора) их сохраняет — реальная разметка DAY6.
    const out = captureListeningPart(
      part(
        `<div class="map-answers"><div class="mcq map-mcq" data-q="11"><div class="stem">Q</div>` +
          `<label><input type="radio" name="q11" value="A"><span class="opt-letter">A</span></label>` +
          `<label><input type="radio" name="q11" value="B"><span class="opt-letter">B</span></label></div></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(questionsHtmlCoversAll(out, [11])).toBe(true);
    expect(out).toContain("map-answers");
  });

  it("канон-точная вычистка: голые токены 'answer'/'key' режутся, легитимный 'answered' цел", () => {
    // 'answer'/'key' мимо findLeakMarkerToken (не в его наборе) → доходят до вычистки и
    // режутся канон-точно; 'answered' (канон answered) остаётся.
    const out = captureListeningPart(
      part(`<div class="answer key answered"><input class="gap" data-q="1"></div>`),
    );
    expect(out).not.toBe("");
    const $ = load(out, null, false);
    const tokens = ($("div").first().attr("class") ?? "").split(/\s+/);
    expect(tokens).toContain("answered");
    expect(tokens).not.toContain("answer");
    expect(tokens).not.toContain("key");
  });

  it("defense-in-depth: атрибут источника со значением-ответом (data-note='Correct answer: B') снят", () => {
    const out = captureListeningPart(
      part(
        `<div class="mcq" data-q="1" data-note="Correct answer: B"><div class="stem">Q</div>` +
          `<label><input type="radio" name="q1" value="A">A</label></div>`,
      ),
    );
    expect(out).not.toBe("");
    expect(out).not.toMatch(/data-note/i);
    expect(out).not.toMatch(/Correct answer/i);
  });
});

describe("captureListeningPart — reveal-marker fail-closed (B1)", () => {
  it("чужой reveal-класс рядом с валидным gap → пустая панель + onLeak(токен)", () => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(
        `<div class="form-row">Name: <input class="gap" data-q="1"></div>` +
          `<div class="correct-answer">Correct answer: PIZZA</div>`,
      ),
      (t) => leaks.push(t),
    );
    expect(out).toBe("");
    expect(leaks).toEqual(["correct-answer"]);
  });

  it("одиночный class-токен 'correct' тоже фейлит панель", () => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(`<input class="gap" data-q="1"><span class="correct">PIZZA</span>`),
      (t) => leaks.push(t),
    );
    expect(out).toBe("");
    expect(leaks).toEqual(["correct"]);
  });

  // Нормализация: регистр + стиль разделителей не должны обходить детектор.
  it.each([
    ["Correct-Answer"],
    ["correctAnswer"],
    ["correct_answer"],
    ["ANSWER-KEY"],
  ])("class-вариант '%s' → fail-closed + onLeak(исходный токен)", (cls) => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(`<input class="gap" data-q="1"><div class="${cls}">PIZZA</div>`),
      (t) => leaks.push(t),
    );
    expect(out).toBe("");
    expect(leaks).toEqual([cls]);
  });

  it("reveal-маркер под id (без class) → fail-closed", () => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(`<input class="gap" data-q="1"><div id="correct-answer">Correct answer: PIZZA</div>`),
      (t) => leaks.push(t),
    );
    expect(out).toBe("");
    expect(leaks).toEqual(["correct-answer"]);
  });

  it("санкционированный [data-analysis] НЕ триггерит fail-closed (штатный стрип)", () => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(`<input class="gap" data-q="1"><div class="analysis" data-analysis="1">A</div>`),
      (t) => leaks.push(t),
    );
    expect(out).not.toBe("");
    expect(leaks).toEqual([]);
    expect(out).not.toMatch(/analysis/i);
  });

  it("легитимные class/id реального корпуса (cstat answered / map-answers / answer-input) НЕ триггерят", () => {
    const leaks: string[] = [];
    const out = captureListeningPart(
      part(
        `<div class="cstat answered">1</div><div class="cstat unanswered">2</div>` +
          `<div class="map-answers">grid</div><span class="answer-input">x</span>` +
          `<div id="map-answers"></div><div id="answered"></div><div id="answer-input"></div>` +
          `<input class="gap" data-q="1">`,
      ),
      (t) => leaks.push(t),
    );
    expect(out).not.toBe("");
    expect(leaks).toEqual([]);
    expect(questionsHtmlCoversAll(out, [1])).toBe(true);
  });
});

describe("captureListeningPart — fail-closed", () => {
  it("непреобразованный select → fail-closed", () => {
    const out = captureListeningPart(
      part(`<input class="gap" data-q="1"><select data-question="2"><option>A</option></select>`),
    );
    expect(out).toBe("");
  });

  it("gap без валидного номера → fail-closed", () => {
    expect(captureListeningPart(part(`<input class="gap" data-q="abc">`))).toBe("");
  });

  it("дубль номера между двумя gap → fail-closed", () => {
    const out = captureListeningPart(part(`<input class="gap" data-q="1"><input class="gap" data-q="1">`));
    expect(out).toBe("");
  });

  it("нет ни одного слота → ''", () => {
    expect(captureListeningPart(part(`<p class="q-instruction">Just instructions</p>`))).toBe("");
  });

  it("пустой вход → ''", () => {
    expect(captureListeningPart("")).toBe("");
  });
});
