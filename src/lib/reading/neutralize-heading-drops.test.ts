import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { neutralizeHeadingDrops } from "./neutralize-heading-drops";

describe("neutralizeHeadingDrops", () => {
  const html =
    `<div class="paragraph-block">` +
    `<div class="heading-drop-line" id="heading-line-A"><div class="heading-drop" id="drop-q14" data-q="14" data-type="drop" data-identifier="Gap1" role="button" tabindex="0" aria-label="Question 14 heading drop zone"><span class="placeholder">14</span></div></div>` +
    `<p id="para-A"><strong>A</strong> Body.</p>` +
    `</div>`;

  it("снимает интерактивную семантику и метит .hd-passive + aria-hidden", () => {
    const $ = load(neutralizeHeadingDrops(html), null, false);
    const drop = $(".heading-drop");
    expect(drop.hasClass("hd-passive")).toBe(true);
    expect(drop.attr("aria-hidden")).toBe("true");
    expect(drop.attr("role")).toBeUndefined();
    expect(drop.attr("tabindex")).toBeUndefined();
    expect(drop.attr("aria-label")).toBeUndefined();
    expect(drop.attr("data-type")).toBeUndefined();
    expect(drop.attr("data-identifier")).toBeUndefined();
    // номер-метка сохранена (пассивная), data-q не тронут
    expect(drop.find(".placeholder").text()).toBe("14");
    expect(drop.attr("data-q")).toBe("14");
  });

  it("без .heading-drop возвращает вход без изменений", () => {
    const plain = `<p class="rp" data-letter="A">Text.</p>`;
    expect(neutralizeHeadingDrops(plain)).toBe(plain);
  });
});
