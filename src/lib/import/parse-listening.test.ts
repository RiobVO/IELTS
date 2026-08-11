// Тесты Listening-парсера (BRIEF §4.2). Inline-фикстура повторяет селекторы
// parse-listening.ts; маршрут через диспетчер parseTest (<audio> + .part).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTest } from "./parse-test";

const sample = (name: string): string | null => {
  const p = fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const LISTENING_HTML = `<!doctype html><html><head><title>IELTS Listening Test - Section</title></head>
<body>
  <audio src="audio/test.mp3"></audio>
  <section class="part" data-part="1">
    <div class="part-banner">Part 1: A conversation</div>
    <p class="q-instruction">Complete the notes below.</p>
    <div class="note-line"><span class="qnum">1</span> Name of the <input class="gap" data-q="1"> service.</div>
    <div class="mcq" data-q="2">
      <p class="stem"><span class="qnum">2</span> What time does it open?</p>
      <label><input type="radio" name="q2" value="A"> 9 am</label>
      <label><input type="radio" name="q2" value="B"> 10 am</label>
      <label><input type="radio" name="q2" value="C"> 11 am</label>
    </div>
    <div class="chip-bank">
      <span class="chip" data-letter="A">Alpha</span>
      <span class="chip" data-letter="B">Beta</span>
    </div>
    <div class="match-row"><span class="mtext">The third item</span><span class="dropzone" data-q="3"></span></div>
    <div class="note-line"><span class="qnum">4</span> Meet at the <input class="gap" data-q="4"> entrance.</div>
  </section>
  <script>
    const KEY = { "1": ["library"], "2": ["A"], "3": ["B"], "4": ["café", "cafe"] };
    function band(r){ return r >= 39 ? 9 : 5; }
  </script>
</body></html>`;

describe("parseListening — inline part", () => {
  const t = parseTest(LISTENING_HTML); // через диспетчер
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("диспетчеризуется в listening по <audio> + .part и тянет аудио/мету", () => {
    expect(t.section).toBe("listening");
    expect(t.category).toBe("full_listening");
    expect(t.bandType).toBe("listening");
    expect(t.passages).toHaveLength(1);
    expect(t.passages[0].audioPath).toBe("audio/test.mp3");
  });

  it("выводит режим ответа из KEY: одна вариация → exact, несколько → text_accept", () => {
    expect(q(1).answer).toMatchObject({ mode: "exact", accept: ["library"] });
    expect(q(4).answer).toMatchObject({ mode: "text_accept", accept: ["café", "cafe"] });
  });

  it("инферит подтип вопроса из разметки части", () => {
    expect(q(1).qtype).toBe("note_completion");
    expect(q(2).qtype).toBe("mcq_single");
    expect(q(3).qtype).toBe("matching_features");
    expect(q(2).options).toHaveLength(3);
  });

  it("материализует band(r) в шкалу 0..40", () => {
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.bandScale!["40"]).toBe(9);
    expect(t.bandScale!["0"]).toBe(5);
  });
});

// --- реальный образец (skip без gitignored-файла) ---

const LISTENING_MAP_MULTI_HTML = `<!doctype html><html><head><title>IELTS Listening Map</title></head>
<body>
  <audio src="audio/map.mp3"></audio>
  <section class="part" data-part="2">
    <div class="part-banner">Part 2: A tour</div>
    <p class="q-instruction">Choose TWO letters, A-E.</p>
    <div class="mcq multi" data-qs="11,12">
      <div class="stem"><span class="qnum">11-12</span><span>Which TWO pieces of advice are given?</span></div>
      <label><input type="checkbox" value="A"><span class="opt-letter">A</span> Stop for lunch.</label>
      <label><input type="checkbox" value="B"><span class="opt-letter">B</span> Bring a coat.</label>
      <label><input type="checkbox" value="C"><span class="opt-letter">C</span> Book early.</label>
    </div>
    <p class="q-instruction">Label the map below.</p>
    <div class="map-dd">
      <div class="map-stage">
        <div class="map-dz" data-letter="A" aria-label="Building A"></div>
        <div class="map-dz" data-letter="B" aria-label="Building B"></div>
      </div>
      <div class="place-bank">
        <div class="place-chip" data-q="15"><span class="pc-num">15</span><span class="pc-text">Exhibition</span></div>
        <div class="place-chip" data-q="16"><span class="pc-num">16</span><span class="pc-text">Baths</span></div>
      </div>
    </div>
  </section>
  <script>
    const KEY = { "11": ["A"], "12": ["C"], "15": ["B"], "16": ["A"] };
    function band(r){ return r >= 4 ? 9 : 0; }
  </script>
</body></html>`;

describe("parseListening gap fixtures", () => {
  const t = parseTest(LISTENING_MAP_MULTI_HTML);
  const q = (n: number) => t.questions.find((x) => x.number === n)!;

  it("atomizes bare checkbox choose-TWO groups as mcq_multi", () => {
    expect(q(11).qtype).toBe("mcq_multi");
    expect(q(11).groupKey).toBe("11-12");
    expect(q(11).answer).toMatchObject({ mode: "mcq_set", accept: ["A", "C"] });
    expect(q(12).answer.mode).toBe("mcq_set");
    expect(q(11).options).toHaveLength(3);
  });

  it("atomizes place-chip map labelling questions", () => {
    expect(q(15).qtype).toBe("map_labelling");
    expect(q(15).promptHtml).toBe("Exhibition");
    expect(q(15).options).toEqual([
      { value: "A", label: "Building A" },
      { value: "B", label: "Building B" },
    ]);
    expect(q(15).answer).toMatchObject({ mode: "exact", accept: ["B"] });
    expect(t.warnings).toHaveLength(0);
  });
});

const listening = sample("listening-test.html");
describe.skipIf(!listening)("real sample — listening-test (40Q)", () => {
  it("4 части / 40 вопросов с аудио и band-шкалой, без предупреждений", () => {
    const t = parseTest(listening!);
    expect(t.section).toBe("listening");
    expect(t.passages).toHaveLength(4);
    expect(t.passages.every((p) => !!p.audioPath)).toBe(true);
    expect(t.questions).toHaveLength(40);
    expect(t.bandScale).not.toBeNull();
    expect(Object.keys(t.bandScale!)).toHaveLength(41);
    expect(t.warnings).toHaveLength(0);
    expect(t.questionTypes).toEqual(
      expect.arrayContaining([
        "note_completion",
        "mcq_single",
        "matching_features",
        "form_completion",
        "table_completion",
      ]),
    );
  });
});
