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

// Ревью 2026-08-11, третий заход: пока в embed'е нельзя ничего спрятать, «что видит
// сканер текста — то видит и студент», поэтому порционная обфускация ключа
// невидимым узлом перестаёт работать.
describe("sanitizeEmbedCss — прятать содержимое запрещено", () => {
  it("display:none / visibility:hidden / opacity:0 / font-size:0 / color:transparent выброшены", () => {
    const out =
      sanitizeEmbedCss(
        `.a{display:none;color:red}.b{visibility:hidden}.c{opacity:0}.d{font-size:0}` +
          `.e{color:transparent}.f{text-indent:-9999px}`,
      ) ?? "";
    expect(out).not.toContain("display:none");
    expect(out).not.toContain("visibility:hidden");
    expect(out).not.toContain("opacity:0");
    expect(out).not.toContain("font-size:0");
    expect(out).not.toContain("color:transparent");
    expect(out).not.toContain("text-indent:-");
    expect(out).toContain("color:red"); // соседняя безопасная декларация цела
  });

  it("!important не обходит запрет", () => {
    expect(sanitizeEmbedCss(`.a{display:none !important}`)).toBeNull();
  });

  it("легитимные значения тех же свойств живут", () => {
    const out = sanitizeEmbedCss(`.a{display:grid;opacity:.85;font-size:13px;visibility:visible}`) ?? "";
    expect(out).toContain("display:grid");
    expect(out).toContain("opacity:.85");
    expect(out).toContain("font-size:13px");
    expect(out).toContain("visibility:visible");
  });
});

// Ревью 2026-08-11, четвёртый заход: одно проходное декодирование не даёт канон-формы
// (`\75rl(` → `\75rl(` — санитайзер не видит url(, браузер декодирует после нас),
// а сканеры не учитывали escape-состояние.
describe("sanitizeEmbedCss — каноничность escape'ов и сканеры", () => {
  // Однозначный обратный слеш: в шаблонных строках его легко потерять при правках.
  const BS = String.fromCharCode(92);

  it("одиночный escape декодируется и проверяется по декодированной форме", () => {
    // `\\75rl(` → `url(` — запрет срабатывает уже по декодированному значению.
    const out = sanitizeEmbedCss(`.mp{background:${BS}75rl("https://evil/x.png");color:red}`) ?? "";
    expect(out).not.toMatch(/75rl|url\(/i);
    expect(out).not.toContain("evil");
    expect(out).toContain("color:red");
    // легитимные одиночные escape'ы живут: `re\\64` → `red`, `.a\\3a hover` → `.a:hover`
    expect(sanitizeEmbedCss(`.a{color:re${BS}64}`) ?? "").toContain("color:red");
    expect(sanitizeEmbedCss(`.a${BS}3a hover{color:red}`) ?? "").toContain(".a:hover");
  });

  it("ДВОЙНОЙ escape (остаточный слеш после декодирования) отбрасывается", () => {
    // `\\\\75rl(` декодируется в `\\75rl(` — санитайзер не увидел бы url(, но его
    // доклеит браузер уже после пересборки; остаточный слеш = отказ.
    expect(sanitizeEmbedCss(`.mp{background:${BS}${BS}75rl("https://evil/x.png")}`)).toBeNull();
    expect(sanitizeEmbedCss(`.a{color:re${BS}${BS}64}`)).toBeNull();
    expect(sanitizeEmbedCss(`.a{colo${BS}${BS}72:red}`)).toBeNull();
    expect(sanitizeEmbedCss(`.a${BS}${BS}3a hover{color:red}`)).toBeNull();
  });

  it("комментарий внутри строки не съедает следующее правило", () => {
    const out = sanitizeEmbedCss(`.a{font-family:"x/*y"}.b{color:red}`) ?? "";
    expect(out).toContain("color:red");
  });

  it("незакрытый комментарий отбрасывает хвост, начало живёт", () => {
    const out = sanitizeEmbedCss(`.a{color:red}/* unterminated .b{color:blue}`) ?? "";
    expect(out).toContain("color:red");
    expect(out).not.toContain("blue");
  });

  it("экранированная кавычка внутри строки не сдвигает границы деклараций", () => {
    const out = sanitizeEmbedCss(`.a{font-family:"A\\"B";top:86px}`) ?? "";
    // значение с остаточным слешем отбрасывается, но СЛЕДУЮЩАЯ декларация цела
    expect(out).toContain("top:86px");
  });

  it("`;` внутри строки преамбулы не рвёт правило", () => {
    const out = sanitizeEmbedCss(`.a[title="x;y"]{color:red}`) ?? "";
    expect(out).toContain("color:red");
  });
});

// Ревью 2026-08-11, пятый заход (HIGH): преамбула @media/@supports уходила в вывод
// целиком, проверенная только на <>{} — остаточный escape мог стать структурным
// разделителем уже в браузере.
describe("sanitizeEmbedCss — преамбула @media/@supports под канон-контролем", () => {
  const BS = String.fromCharCode(92);

  it("нормальные условия проходят и содержимое фильтруется", () => {
    const out = sanitizeEmbedCss(`@media (max-width:700px) and (min-resolution:2dppx){.mp{width:100%}}`) ?? "";
    expect(out).toContain("@media (max-width:700px) and (min-resolution:2dppx){");
    expect(out).toContain("width:100%");
    expect(sanitizeEmbedCss(`@supports (display:grid){.mp{display:grid}}`) ?? "").toContain("@supports");
  });

  it("остаточный слеш в преамбуле → правило целиком отброшено", () => {
    expect(sanitizeEmbedCss(`@media${BS}${BS}20screen{.mp{color:red}}`)).toBeNull();
  });

  it("url()/сетевые функции в преамбуле → отброшено", () => {
    expect(sanitizeEmbedCss(`@media (min-width:1px) url(https://evil/x){.mp{color:red}}`)).toBeNull();
  });

  it("структурные символы и посторонние символы в условии → отброшено", () => {
    expect(sanitizeEmbedCss(`@media screen;@import "https://evil/x.css"{.mp{color:red}}`)).toBeNull();
    expect(sanitizeEmbedCss(`@media screen<x>{.mp{color:red}}`)).toBeNull();
    expect(sanitizeEmbedCss(`@media "quoted"{.mp{color:red}}`)).toBeNull();
  });

  it("вложенный @media внутри @supports сохраняется", () => {
    const out = sanitizeEmbedCss(`@supports (display:grid){@media (max-width:700px){.mp{color:red}}}`) ?? "";
    expect(out).toContain("@supports (display:grid){");
    expect(out).toContain("@media (max-width:700px){");
    expect(out).toContain("color:red");
  });
});

// Ревью 2026-08-11, шестой заход (HIGH): `<`/`>` разрешались ВНУТРИ CSS-строк, а
// HTML-парсер про кавычки CSS не знает — `</style>` в строке закрывает raw-text тег.
describe("sanitizeEmbedCss — угловые скобки запрещены и внутри строк", () => {
  it("breakout из строки в ЗНАЧЕНИИ декларации отброшен, соседнее правило цело", () => {
    const out = sanitizeEmbedCss(`.a{font-family:"</style><p>PWNED</p><style>"}.b{color:red}`) ?? "";
    expect(out).not.toContain("PWNED");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("color:red");
  });

  it("breakout из строки в СЕЛЕКТОРЕ отброшен", () => {
    const out = sanitizeEmbedCss(`.a[title="</style><p>PWNED</p>"]{color:red}.b{color:blue}`) ?? "";
    expect(out).not.toContain("PWNED");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("color:blue");
  });

  it("breakout в инлайн-стиле фрагмента отброшен", () => {
    expect(sanitizeInlineMapStyle(`font-family:"</style><p>x</p>"`)).toBeNull();
    expect(sanitizeInlineMapStyle(`top:86px;font-family:"</style>"`)).toBe("top:86px");
  });

  it("в собранном стайлшите не остаётся ни одной угловой скобки", () => {
    const out = sanitizeEmbedCss(`.mp{position:relative}@media (max-width:700px){.mp{width:100%}}`) ?? "";
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("position:relative");
  });
});
