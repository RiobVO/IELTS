import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunner } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";

const FIX = join(__dirname, "fixtures");
const reading = readFileSync(join(FIX, "reading.html"), "utf8");
const listening = readFileSync(join(FIX, "listening.html"), "utf8");

describe("sanitizeRunner — reading", () => {
  const r = parseRunner(reading);
  const out = sanitizeRunner(reading, { contentItemId: "cid-1", section: "reading" });
  it("вырезает объявления ключей в пустышку", () => {
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(out).toMatch(/const acceptableAnswers\s*=\s*\{\}/);
  });
  it("ни один ответ из answer_key не встречается в выходе (анти-утечка)", () => {
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
  it("анти-утечка ловит ключи в СЫРОМ файле (гейт не пустышка)", () => {
    expect(() => assertNoKeyLeak(reading, r.parsed)).toThrow(/key leak/i);
  });
  it("уникализирует STORAGE_KEY под contentItemId", () => {
    expect(out).toContain("cid-1");
    expect(out).not.toMatch(/ielts_cdi_camb21_test1_full_v1['"]/);
  });
  it("удаляет внешний html2pdf <script>", () => {
    expect(out).not.toMatch(/html2pdf/);
  });
  it("инжектит мост reading (override showResults)", () => {
    expect(out).toContain("ielts-submit");
    expect(out).toMatch(/showResults\s*=/);
  });
});

// N1 (AUDIT_2026-07-02): mcq-буквы короче 3 символов проскакивали бэкстоп, а
// mcqGroups (несёт correct-набор) вообще не вырезался; ключ под нераспознанным
// именем объекта оставался в published runner_html молча.
describe("assertNoKeyLeak — N1 hardening", () => {
  const mcqHtml = `<!doctype html><html><head><title>R</title></head><body><div></div>
<script>
var correctAnswers = {"1":"TRUE"};
var questionTypes = {"1":"True/False/Not Given","4":"MCQ","5":"MCQ"};
var mcqGroups = {"4-5": {"qs":[4,5],"correct":["A","C"]}};
</script></body></html>`;
  const r = parseRunner(mcqHtml);

  it("сырой mcq-файл ловится гейтом (короткие буквы не пропускаются)", () => {
    expect(() => assertNoKeyLeak(mcqHtml, r.parsed)).toThrow(/key/i);
  });

  it("sanitize вырезает mcqGroups, после чего гейт чист", () => {
    const out = sanitizeRunner(mcqHtml, { contentItemId: "cid-3", section: "reading" });
    expect(out).toMatch(/var mcqGroups\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });

  it("числовой key-map под нераспознанным именем роняет гейт", () => {
    const renamed = `<!doctype html><html><head><title>R</title></head><body>
<script>var ANSWERS = {"1":"mining","2":"C","3":"1985","4":"B"};</script></body></html>`;
    const rr = parseRunner(renamed); // парсер его не видит — 0 вопросов
    const out = sanitizeRunner(renamed, { contentItemId: "cid-4", section: "reading" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).toThrow(/key/i);
  });

  // QA-партия 2026-07-02: у источника Vol7/Mock варианты ответов лежат в
  // acceptableVariants — парсер знал только acceptableAnswers, санитайзер не
  // вырезал объект, детектор (по делу) ронял импорт. Теперь объект вырезается.
  it("вырезает acceptableVariants (альтернативное имя контейнера вариантов)", () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {"1":"raindrops"};
const acceptableVariants = { 1: ['raindrops','raindrop'], 5: ['frogs','frog'], 7: ['x-ray'], 9: ['a b'] };</script>
</body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-6", section: "reading" });
    expect(out).toMatch(/const acceptableVariants\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Listening Mock (QA 2026-07-02): listening-файл хранит ключ в READING-контейнере
  // correctAnswers — пер-секционные списки вырезания пропускали его целиком.
  // Вырезается объединение всех известных контейнеров независимо от секции.
  it("вырезает reading-контейнеры и в listening-файле (union)", () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio></audio>
<script>const correctAnswers = { 1: 'light', 2: 'manager', 3: 'automatic', 4: 'tires' };</script>
</body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-9", section: "listening" });
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // partConfig-кейс (Listening Mock 1): числовые ключи с ОБЪЕКТАМИ-значениями —
  // это UI-конфиг секций, не карта ответов; детектор не должен его ронять.
  it("числовой конфиг с объектами-значениями не даёт ложного срабатывания", () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio src="x.mp3"></audio>
<script>const KEY = {"1":["cat"],"2":["dog"],"3":["sun"],"4":["sky"]};
const partConfig = { 1:{title:"Section 1"}, 2:{title:"Section 2"}, 3:{title:"Section 3"}, 4:{title:"Section 4"} };</script>
</body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-7", section: "listening" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Vol5 T10-кейс: UI-строка ' Evidence' (лейбл кнопки) не должна матчиться как
  // литерал ответа "evidence" — \s*-паддинг в проверке давал ложный key leak.
  it("UI-строка с паддингом не матчится как литерал ответа", () => {
    const html = `<!doctype html><html><head><title>L</title></head><body><audio src="x.mp3"></audio>
<script>const KEY = {"31":["evidence"],"32":["method"],"33":["theory"],"34":["result"]};
function ui(){ const btn = { html: 'Q31' + ' Evidence' }; return btn; }</script>
</body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-8", section: "listening" });
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // P2 (2026-07-09): апостроф в комментарии ВНУТРИ объекта ключей рвал баланс скобок в
  // extractObjectLiteral → blankObject молча возвращал src без изменений → сырой
  // correctAnswers уезжал в runner_html (view-source утечка ключа mock-iframe). Правка
  // сканера (comment-aware) чинит обоих потребителей; здесь — санитайзер-потребитель.
  it("вырезает correctAnswers несмотря на апостроф в комментарии внутри объекта (P2)", () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = { // don't touch — validated
"1":"mining","2":"tourism","3":"granite","4":"delta" };</script></body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-p2", section: "reading" });
    expect(out).toMatch(/const correctAnswers\s*=\s*\{\}/);
    expect(out).not.toContain("mining"); // ключ НЕ уехал в браузер
    expect(out).not.toContain("tourism");
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  // Adversarial (Codex, 2026-07-09): комментарий МЕЖДУ `=` и `{` ронял extractObjectLiteral
  // в null до comment-aware цикла → blankObject молча пропускал mcqGroups → correct-набор
  // букв уезжал в runner_html (assertNoKeyLeak не ловит: layer1-regex не матчит `= /*..*/ {`,
  // буквы A/C короче 3 символов). Пре-скан теперь comment-aware — объект вырезается.
  it("вырезает mcqGroups с комментарием между `=` и `{` (P2 vector A)", () => {
    const html = `<!doctype html><html><head><title>R</title></head><body>
<script>const correctAnswers = {"1":"A","2":"B","3":"C","4":"D"};
const mcqGroups = /* between */ {"1-4":{"qs":[1,2,3,4],"correct":["A","C"]}};</script></body></html>`;
    const rr = parseRunner(html);
    const out = sanitizeRunner(html, { contentItemId: "cid-va", section: "reading" });
    expect(out).toMatch(/const mcqGroups\s*=\s*\/\* between \*\/\s*\{\}/);
    expect(out).not.toContain(`"correct":["A","C"]`); // ключ-набор НЕ уехал в браузер
    expect(() => assertNoKeyLeak(out, rr.parsed)).not.toThrow();
  });

  it("время в строках не даёт ложного срабатывания детектора", () => {
    const benign = `<!doctype html><html><head><title>R</title></head><body>
<script>var correctAnswers = {"1":"TRUE"};
var ui = { labels: ["12:30","13:45","14:00","15:15"] };</script></body></html>`;
    const rb = parseRunner(benign);
    const out = sanitizeRunner(benign, { contentItemId: "cid-5", section: "reading" });
    expect(() => assertNoKeyLeak(out, rb.parsed)).not.toThrow();
  });
});

describe("sanitizeRunner — listening", () => {
  const r = parseRunner(listening);
  const out = sanitizeRunner(listening, {
    contentItemId: "cid-2",
    section: "listening",
    audioUrl: "https://store.example/audio/cid-2.mp3",
  });
  it("подменяет <audio src> на наш URL", () => {
    expect(out).toContain("https://store.example/audio/cid-2.mp3");
    expect(out).not.toContain("archive.org");
  });
  it("анти-утечка чистая после очистки (evidence вырезан)", () => {
    expect(() => assertNoKeyLeak(out, r.parsed)).not.toThrow();
  });
  it("инжектит мост listening (override doSubmit.onclick)", () => {
    expect(out).toContain("ielts-submit");
    expect(out).toMatch(/getElementById\(['"]doSubmit['"]\)\.onclick/);
  });
});
