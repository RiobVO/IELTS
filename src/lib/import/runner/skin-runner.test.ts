import { describe, it, expect } from "vitest";
import { skinRunnerGate, skinRunnerBrand } from "./skin-runner";

describe("skinRunnerGate", () => {
  const gate =
    '<html><head><style>.x{color:#000}</style></head><body>' +
    '<div class="overlay play-ov" id="playOverlay">🎧</div></body></html>';

  it("инжектит bando-skin перед </head> для listening-gate", () => {
    const out = skinRunnerGate(gate);
    expect(out).toContain("bando-gate-skin");
    // перед закрытием head
    expect(out.indexOf("bando-gate-skin")).toBeLessThan(out.indexOf("</head>"));
    // ПОСЛЕ оригинального стиля файла → override выигрывает по порядку
    expect(out.indexOf(".x{color:#000}")).toBeLessThan(out.indexOf("bando-gate-skin"));
  });

  it("no-op без #playOverlay (reading-раннер / нет гейта)", () => {
    const reading = '<html><head></head><body><div id="other"></div></body></html>';
    expect(skinRunnerGate(reading)).toBe(reading);
  });

  it("идемпотентно — повторный инжект исключён маркером", () => {
    const once = skinRunnerGate(gate);
    expect(skinRunnerGate(once)).toBe(once);
  });

  it("no-op без </head> (нет безопасной точки инжекта)", () => {
    const noHead = '<div id="playOverlay"></div>';
    expect(skinRunnerGate(noHead)).toBe(noHead);
  });
});

// Реальная шапка раннера (из прод runner_html): картинка-логотип источника,
// стилизованный вордмарк «IELTS™» и кликабельный ЧУЖОЙ telegram-канал.
const LISTENING_HEAD = `<!doctype html><html><head><title>IELTS Listening — Cambridge 21 Test 1</title>
<style>.header .logo{color:var(--red)}</style></head><body>
<div class="header"><div class="brand">
<img src="data:image/png;base64,iVBORw0KGgoAAAANS" class="brand-logo" alt="9 IELTS logo">
<span class="logo">IELTS<sup>™</sup></span>
<a class="brand-telegram" href="https://t.me/EnjoyListeningTests" target="_blank" rel="noopener noreferrer" title="Join"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></a>
</div></div>
<div id="playOverlay">gate</div>
</body></html>`;

// Reading-вариант — тот же шаблон, другой чужой канал, без playOverlay.
const READING_HEAD = `<!doctype html><html><head><title>IELTS Reading Test - The Davies Sisters</title></head><body>
<div class="header"><div class="brand">
<img src="data:image/png;base64,AAAA" class="brand-logo" alt="9 IELTS logo">
<span class="logo">IELTS<sup>™</sup></span>
<a class="brand-telegram" href="https://t.me/CD_materialss" target="_blank" rel="noopener">tg</a>
</div></div>
</body></html>`;

describe("skinRunnerBrand", () => {
  const out = skinRunnerBrand(LISTENING_HEAD);

  it("удаляет чужой telegram-канал целиком (анти-увод трафика)", () => {
    expect(out).not.toContain("t.me/EnjoyListeningTests");
    expect(out).not.toContain("brand-telegram");
  });

  it("убирает картинку-логотип источника", () => {
    expect(out).not.toContain("brand-logo");
    expect(out).not.toContain("9 IELTS logo");
  });

  it("заменяет стилизованный вордмарк IELTS™ на bando-знак", () => {
    expect(out).not.toMatch(/<span\s+class=["']logo["']>/i);
    expect(out).toContain("bando-brand");
    expect(out).toMatch(/band<i>o<\/i>/);
  });

  it("инжектит bando-brand-skin перед </head> (после стилей файла → выигрывает)", () => {
    expect(out).toMatch(/bando-brand-skin[\s\S]*<\/head>/i);
    expect(out.indexOf("bando-brand-skin")).toBeLessThan(out.indexOf("</head>"));
  });

  it("идемпотентен (повторный вызов не дублирует)", () => {
    expect(skinRunnerBrand(out)).toBe(out);
  });

  it("работает на reading-варианте (другой канал) — оба убраны", () => {
    const r = skinRunnerBrand(READING_HEAD);
    expect(r).not.toContain("t.me/CD_materialss");
    expect(r).toContain("bando-brand");
    expect(r).not.toContain("brand-logo");
  });

  it("no-op на html без шапки раннера (незнакомый шаблон — не калечим)", () => {
    const plain = "<!doctype html><html><head></head><body><p>hi</p></body></html>";
    expect(skinRunnerBrand(plain)).toBe(plain);
  });
});
