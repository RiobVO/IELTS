import { describe, it, expect } from "vitest";
import {
  skinRunnerGate,
  skinRunnerBrand,
  skinRunnerTableScroll,
  runnerBrandResidue,
} from "./skin-runner";

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
<script>const CHANNEL='@EnjoyListeningTests';const CHANNEL_URL='t.me/EnjoyListeningTests';</script>
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

  it("вычищает чужой канал и из share-card JS (CHANNEL/CHANNEL_URL обнулены)", () => {
    expect(out).not.toMatch(/t\.me\//i);
    expect(out).toMatch(/CHANNEL\s*=\s*['"]['"]/);
    expect(out).toMatch(/CHANNEL_URL\s*=\s*['"]['"]/);
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

  // CDI-источник (QA 2026-07-02): вордмарк — span.ielts-logo (не span.logo), канал —
  // тот же a.brand-telegram. Ранний return по нераспознанной шапке не пускал даже
  // готовую очистку канала.
  it("CDI-шапка: ielts-logo → bando, канал срезан", () => {
    const cdi = `<!doctype html><html><head><title>R</title></head><body>
<header class="header"><div class="header__logo"><div class="brand">
<span class="ielts-logo" aria-label="IELTS">IELTS</span>
<a class="brand-telegram" href="https://t.me/CD_materialss" target="_blank" title="Join"><i class="fa-brands fa-telegram"></i></a>
</div></div></header></body></html>`;
    const r = skinRunnerBrand(cdi);
    expect(r).not.toMatch(/t\.me\//i);
    expect(r).not.toContain("brand-telegram");
    expect(r).toContain("bando-brand");
    expect(r).not.toContain("ielts-logo");
  });

  // ReadinMarathons/Mock-вариант: вордмарк — <div class="ielts-logo">, канал —
  // a.telegram-link (режется href-регэкспом).
  it("div.ielts-logo → bando (вордмарк не обязан быть span)", () => {
    const rm = `<!doctype html><html><head><title>R</title></head><body>
<header class="header"><div class="header__logo">
<div class="ielts-logo">IELTS</div>
<a class="telegram-link" href="https://t.me/ReadinMarathons" target="_blank"><i class="fab fa-telegram"></i></a>
</div></header></body></html>`;
    const r = skinRunnerBrand(rm);
    expect(r).not.toMatch(/t\.me\//i);
    expect(r).toContain("bando-brand");
    expect(r).not.toContain("ielts-logo");
    expect(r).not.toContain("header__logo>IELTS"); // header__logo-обёртка не тронута
  });

  it("чужой t.me режется ДАЖЕ при нераспознанной шапке (трафик ≠ вёрстка)", () => {
    const newSource =
      '<html><head></head><body><div class="topbar">' +
      '<a href="https://t.me/SomeNewChannel">join</a></div></body></html>';
    const r = skinRunnerBrand(newSource);
    expect(r).not.toMatch(/t\.me\//i);
    expect(r).not.toContain("SomeNewChannel");
  });
});

describe("skinRunnerTableScroll", () => {
  const withTable =
    '<html><head><style>.matching-table{width:100%;overflow:hidden}</style></head>' +
    '<body><div class="question-content"><table class="matching-table" data-letters="A,B,C,D,E,F,G,H,I"></table></div></body></html>';

  it("инжектит мобильный table-scroll style перед </head> при наличии .matching-table", () => {
    const out = skinRunnerTableScroll(withTable);
    expect(out).toContain("bando-mtable-scroll");
    expect(out.indexOf("bando-mtable-scroll")).toBeLessThan(out.indexOf("</head>"));
    // после оригинального стиля файла → override выигрывает по порядку источника
    expect(out.indexOf(".matching-table{width:100%")).toBeLessThan(out.indexOf("bando-mtable-scroll"));
    expect(out).toMatch(/@media\(max-width:680px\)\{\.matching-table\{display:block;overflow-x:auto;max-width:100%\}\}/);
  });

  it("no-op без .matching-table (шаблоны без сеток / listening)", () => {
    const noTable = '<html><head></head><body><table class="score-table"></table></body></html>';
    expect(skinRunnerTableScroll(noTable)).toBe(noTable);
  });

  it("no-op без </head> (нет безопасной точки инъекции)", () => {
    const noHead = '<div><table class="matching-table"></table></div>';
    expect(skinRunnerTableScroll(noHead)).toBe(noHead);
  });

  it("идемпотентно — повторный инжект исключён маркером", () => {
    const once = skinRunnerTableScroll(withTable);
    expect(skinRunnerTableScroll(once)).toBe(once);
  });

  it("skinRunnerBrand подхватывает table-scroll в пайплайне (гейт на .matching-table)", () => {
    const out = skinRunnerBrand(withTable);
    expect(out).toContain("bando-mtable-scroll");
  });

  // Codex 2026-07-11: brand-ранний-return срабатывал ДО table-инжекта — уже
  // ребрендированный html (double-skin путь) оставался без мобильного фикса.
  it("уже ребрендированный html (bando-brand-skin) всё равно получает table-scroll", () => {
    const branded =
      '<html><head><style id="bando-brand-skin"></style></head>' +
      '<body><table class="matching-table"></table></body></html>';
    const out = skinRunnerBrand(branded);
    expect(out).toContain("bando-mtable-scroll");
    // и идемпотентность цепочки целиком: повторный прогон ничего не добавляет
    expect(skinRunnerBrand(out)).toBe(out);
  });
});

describe("runnerBrandResidue (import-time guard)", () => {
  it("чисто на распознанной шапке (логотип заменён, канал убран)", () => {
    expect(runnerBrandResidue(LISTENING_HEAD)).toEqual([]);
    expect(runnerBrandResidue(READING_HEAD)).toEqual([]);
  });

  it("чисто на html без всякого брендинга", () => {
    expect(runnerBrandResidue("<html><head></head><body><p>hi</p></body></html>")).toEqual([]);
  });

  // После развязки трафик-очистки от вёрстки t.me срезается всегда → residue по
  // нему пуст; residue-детектор остаётся страховкой на ВЫЖИВШИЙ после очистки мусор.
  it("не флагует t.me на нераспознанной шапке — он уже срезан очисткой", () => {
    const newSource =
      '<html><head></head><body><div class="topbar">' +
      '<a href="https://t.me/SomeNewChannel">join</a></div></body></html>';
    expect(runnerBrandResidue(newSource)).toEqual([]);
  });

  it("чисто на CDI-шапке (ielts-logo распознан)", () => {
    const cdi = `<html><head></head><body><div class="brand">
<span class="ielts-logo">IELTS</span>
<a class="brand-telegram" href="https://t.me/CD_materialss">tg</a></div></body></html>`;
    expect(runnerBrandResidue(cdi)).toEqual([]);
  });
});
