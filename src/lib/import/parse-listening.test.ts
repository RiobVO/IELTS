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
