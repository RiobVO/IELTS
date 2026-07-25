import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { normalizePassageHtml } from "./normalize-passage";

/** Хелпер: разобрать нормализованный HTML обратно для ассертов. */
const $$ = (html: string) => load(html, null, false);

describe("normalizePassageHtml", () => {
  it("plain <p> (Banff): нумерует абзацы A,B и метит первый data-first", () => {
    const html =
      '<h1>Banff National Park</h1><p id="para-1">Every year, over five million visitors…</p>' +
      '<p id="para-2">Only a small proportion…</p>';
    const $ = $$(normalizePassageHtml(html, "Banff National Park"));
    expect($("h1").length).toBe(0); // дубль-заголовок снят
    const ps = $("p.rp");
    expect(ps.length).toBe(2);
    expect(ps.eq(0).attr("data-letter")).toBe("A");
    expect(ps.eq(0).attr("data-first")).toBeDefined();
    expect(ps.eq(1).attr("data-letter")).toBe("B");
    expect(ps.eq(1).attr("data-first")).toBeUndefined();
    expect(ps.eq(0).text()).toContain("Every year");
  });

  it("subtitle (Tuatara): подзаголовок не абзац, первый абзац после него = A/data-first", () => {
    const html =
      "<h1>The tuatara – past and future</h1>" +
      '<p class="subtitle">New Zealand\'s iconic reptile…</p>' +
      '<p id="p1">The New Zealand species of lizard…</p><p id="p2">When European explorers…</p>';
    const $ = $$(normalizePassageHtml(html, "The tuatara – past and future"));
    expect($("p.subtitle").length).toBe(1);
    expect($("p.subtitle").hasClass("rp")).toBe(false);
    const ps = $("p.rp");
    expect(ps.length).toBe(2);
    expect(ps.eq(0).attr("data-letter")).toBe("A");
    expect(ps.eq(0).attr("data-first")).toBeDefined();
    expect(ps.eq(0).text()).toContain("The New Zealand species");
    expect(ps.eq(1).attr("data-letter")).toBe("B");
  });

  it(".para-block/.para-letter (How to be Happy): извлекает букву, разворачивает в <p class=rp>", () => {
    const html =
      "<h1>How to be Happy</h1>" +
      '<p class="subtitle">Some recent developments…</p>' +
      '<div class="para-block"><div class="para-letter">A</div><p id="para-A">Psychiatrist Tony Fernando…</p></div>' +
      '<div class="para-block"><div class="para-letter">B</div><p id="para-B">The idea that we can train…</p></div>';
    const $ = $$(normalizePassageHtml(html, "How to be Happy"));
    expect($(".para-block").length).toBe(0); // обёртки убраны
    expect($(".para-letter").length).toBe(0);
    const ps = $("p.rp");
    expect(ps.length).toBe(2);
    expect(ps.eq(0).attr("data-letter")).toBe("A");
    expect(ps.eq(0).attr("data-first")).toBeDefined();
    expect(ps.eq(0).text()).toContain("Psychiatrist Tony Fernando");
    expect(ps.eq(1).attr("data-letter")).toBe("B");
  });

  it("span.para-label внутри <p> (Volume 7): извлекает букву, убирает span", () => {
    const html =
      '<p><span class="para-label">A</span> Olive oil is produced from the fruit…</p>' +
      '<p><span class="para-label">B</span> Archaeologists today are divided…</p>';
    const $ = $$(normalizePassageHtml(html, "IELTS Reading — Volume 7 Test 3"));
    expect($(".para-label").length).toBe(0);
    const ps = $("p.rp");
    expect(ps.eq(0).attr("data-letter")).toBe("A");
    expect(ps.eq(0).text().trim().startsWith("Olive oil")).toBe(true); // ведущий пробел снят
    expect(ps.eq(1).attr("data-letter")).toBe("B");
  });

  it("matching (world population): интерактивную разметку НЕ трогает, только дубль-заголовок", () => {
    const html =
      "<h1>Effects of changes in world population</h1>" +
      '<div class="paragraph-block">' +
      '<div class="heading-drop-line"><div class="heading-drop" data-q="14"><span class="placeholder">14</span></div>' +
      '<button class="review-flag" data-q="14">flag</button></div>' +
      '<p id="para-A" data-para="A"><strong>A</strong> Human fertility rates…</p></div>';
    const $ = $$(normalizePassageHtml(html, "Effects of changes in world population"));
    expect($("h1").length).toBe(0); // дубль снят
    expect($(".heading-drop").length).toBe(1); // механика цела
    expect($(".review-flag").length).toBe(1);
    expect($("strong").first().text()).toBe("A"); // встроенная буква не тронута
    expect($("p.rp").length).toBe(0); // не унифицируем matching
  });

  it("заголовок-имя пассажа (не дубль title) НЕ удаляется", () => {
    const html = '<h2>The early history of olive oil</h2><p id="p1">Olive oil is produced…</p>';
    const $ = $$(normalizePassageHtml(html, "IELTS Reading — Volume 7 Test 3"));
    expect($("h2").length).toBe(1);
    expect($("h2").text()).toBe("The early history of olive oil");
  });
});
