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
