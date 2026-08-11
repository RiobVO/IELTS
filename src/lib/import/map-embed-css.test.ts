import { describe, it, expect } from "vitest";
import { decodeCssEscapes, sanitizeEmbedCss, sanitizeInlineMapStyle } from "./map-embed-css";

// Санитайзер собирает стайлшит ЗАНОВО из allowlist'а (см. док модуля): всё
// нераспознанное не переживает пересборку. Тесты держат оба берега — что вырезано
// (векторы ревью 2026-08-11) и что обязано выжить (CSS-рисунок карты Day 6).

describe("decodeCssEscapes", () => {
  it("hex-escape с пробелом-терминатором и без", () => {
    expect(decodeCssEscapes("\\63ontent")).toBe("content");
    expect(decodeCssEscapes("\\0041 nswer")).toBe("Answer");
    expect(decodeCssEscapes("\\3a  B")).toBe(": B");
  });

  it("escape произвольного символа", () => {
    expect(decodeCssEscapes("u\\72l")).toBe("url");
    expect(decodeCssEscapes("a\\/b")).toBe("a/b");
  });

  it("NUL/суррогат → U+FFFD (не даёт склеить запрещённый токен)", () => {
    expect(decodeCssEscapes("\\0")).toBe("\uFFFD");
    expect(decodeCssEscapes("\\d800")).toBe("\uFFFD");
  });
});

describe("sanitizeEmbedCss — что выживает (карта обязана рисоваться)", () => {
  it("позиции, палитра в кастом-свойствах, grid/flex, SVG-обводка", () => {
    const out = sanitizeEmbedCss(
      `:root{--line:#ccc;--fg:#111}` +
        `.mp{position:relative;--accent:#8170ea}` +
        `.map-body{display:grid;grid-template-columns:1fr 26px 1fr;gap:26px}` +
        `.street{position:absolute;top:86px;border-left:1px solid var(--line)}` +
        `.compass svg{fill:none;stroke:currentColor;stroke-width:1.9}`,
    );
    expect(out).toContain("--line:#ccc");
    expect(out).toContain("--accent:#8170ea");
    expect(out).toContain("top:86px");
    expect(out).toContain("grid-template-columns:1fr 26px 1fr");
    expect(out).toContain("stroke-width:1.9");
    expect(out).toContain("var(--line)");
  });

  it("@media рекурсируется, содержимое фильтруется", () => {
    const out = sanitizeEmbedCss(`@media (max-width:700px){.mp{width:100%;behavior:url(x.htc)}}`);
    expect(out).toContain("@media (max-width:700px){");
    expect(out).toContain("width:100%");
    expect(out).not.toContain("behavior");
  });

  it("инертный content (стрелка Day 6) сохраняется", () => {
    expect(sanitizeEmbedCss(`.arrow::after{content:"→"}`)).toContain('content:"→"');
    expect(sanitizeEmbedCss(`.x::after{content:none}`)).toContain("content:none");
  });

  it("двоеточие внутри строки в СЕЛЕКТОРЕ не ломает правило (ревью, LOW)", () => {
    const out = sanitizeEmbedCss(`.mp[data-label="content:map"]{color:red}`);
    expect(out).toContain('.mp[data-label="content:map"]');
    expect(out).toContain("color:red");
  });
});

describe("sanitizeEmbedCss — векторы утечки ответа", () => {
  it("content с текстом ответа отбрасывается (декларация не переживает пересборку)", () => {
    const out = sanitizeEmbedCss(`.a::after{content:"Correct answer: B";color:red}`) ?? "";
    expect(out).not.toContain("Correct answer");
    expect(out).toContain("color:red"); // соседняя безопасная декларация цела
  });

  it("CSS-escape в ИМЕНИ свойства + разрезанная строка (блокер 3 второго захода)", () => {
    const out = sanitizeEmbedCss(`.a::after{\\63ontent:"\\41nswer" "\\3a  B"}`) ?? "";
    expect(out).not.toMatch(/content/i);
    expect(out).not.toMatch(/answer/i);
  });

  it("разрезание строк и escape в значении content", () => {
    expect(sanitizeEmbedCss(`.a::after{content:"Answer" ": B"}`) ?? "").not.toMatch(/answer/i);
    expect(sanitizeEmbedCss(`.a::after{content:"\\41nswer"}`) ?? "").not.toMatch(/answer/i);
  });

  it("var()-индирекция: строка в кастом-свойстве не проходит", () => {
    const out = sanitizeEmbedCss(`.mp{--x:"Answer: B"}.a::after{content:var(--x)}`) ?? "";
    expect(out).not.toContain("--x");
    expect(out).not.toContain("var(--x)");
  });

  it("attr()/counter() в content не проходят", () => {
    const out = sanitizeEmbedCss(`.a::after{content:attr(data-k)}.b::after{content:counter(c)}`) ?? "";
    expect(out).not.toContain("attr(");
    expect(out).not.toContain("counter(");
  });
});

describe("sanitizeEmbedCss — сеть и выход из <style>", () => {
  it("url() в любой форме, включая escape-обфускацию (ревью, MEDIUM)", () => {
    expect(sanitizeEmbedCss(`.mp{background:url("https://evil/x.png");color:red}`) ?? "").not.toContain("url(");
    expect(sanitizeEmbedCss(`.mp{background:u\\72l("https://evil/x.png")}`) ?? "").not.toMatch(/https:/);
  });

  it("@import отбрасывается вместе с преамбулой правила", () => {
    const out = sanitizeEmbedCss(`@import "https://evil/x.css";.mp{color:red}`) ?? "";
    expect(out).not.toContain("@import");
    expect(out).not.toContain("evil");
    expect(out).toContain("color:red");
  });

  it("@keyframes/@font-face выбрасываются целиком", () => {
    const out = sanitizeEmbedCss(`@font-face{font-family:x;src:url(https://e/f.woff)}.mp{color:red}`) ?? "";
    expect(out).not.toContain("@font-face");
    expect(out).not.toContain("https");
    expect(out).toContain("color:red");
  });

  it("</style>-breakout: и прямой, и синтезированный стрипом комментария (блокер 2)", () => {
    for (const css of [
      `.mp{color:black}</style><p>PWNED</p><style>.x{color:red}`,
      `.mp{color:black}</sty/**/le><p>PWNED</p><style>.x{color:red}`,
    ]) {
      const out = sanitizeEmbedCss(css) ?? "";
      expect(out).not.toContain("PWNED");
      expect(out).not.toContain("<");
      expect(out).not.toContain(">");
    }
  });

  it("пустой/полностью небезопасный вход → null", () => {
    expect(sanitizeEmbedCss("")).toBeNull();
    expect(sanitizeEmbedCss("/* only a comment */")).toBeNull();
    expect(sanitizeEmbedCss(`@import "https://evil/x.css";`)).toBeNull();
  });
});

describe("sanitizeInlineMapStyle", () => {
  it("позиции сохраняются, кастом-строки/content/url — нет", () => {
    expect(sanitizeInlineMapStyle(`top:86px;left:12px`)).toBe("top:86px;left:12px");
    expect(sanitizeInlineMapStyle(`top:86px;--x:"Answer: B"`)).toBe("top:86px");
    expect(sanitizeInlineMapStyle(`top:86px;content:"Answer: B"`)).toBe("top:86px");
    expect(sanitizeInlineMapStyle(`background:url(https://e/x.png);top:0`)).toBe("top:0");
  });

  it("`;` внутри строки не рвёт следующую декларацию (ревью, LOW)", () => {
    expect(sanitizeInlineMapStyle(`font-family:"A;B";top:86px`)).toBe(`font-family:"A;B";top:86px`);
  });

  it("ничего безопасного → null", () => {
    expect(sanitizeInlineMapStyle(`--x:"Answer: B"`)).toBeNull();
    expect(sanitizeInlineMapStyle(``)).toBeNull();
  });
});
