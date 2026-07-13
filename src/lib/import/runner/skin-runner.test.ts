import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  skinRunnerGate,
  skinRunnerBrand,
  skinRunnerTableScroll,
  skinRunnerAudioDefer,
  skinRunnerAudioLabel,
  runnerBrandResidue,
  audioDeferredKickJs,
  injectProgressBridge,
  AUDIO_PRELOAD_JS_ANCHOR,
} from "./skin-runner";
import { READING_BRIDGE, LISTENING_BRIDGE } from "./bridge";
import { forceRunnerMode } from "./force-mode";

const FIX = join(__dirname, "fixtures");
const listeningFixture = readFileSync(join(FIX, "listening.html"), "utf8");

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

describe("skinRunnerAudioDefer", () => {
  const out = skinRunnerAudioDefer(listeningFixture);

  it("preload='auto' на <audio> заменён на 'metadata' (реальная фикстура)", () => {
    const audioTag = out.match(/<audio\b[^>]*>/i)?.[0] ?? "";
    expect(audioTag).not.toMatch(/preload=(["'])auto\1/);
    expect(audioTag).toMatch(/preload="metadata"/);
  });

  it("audio.load() больше не вызывается на верхнем уровне — только внутри deferred-обработчика", () => {
    // ровно одно вхождение во всём файле, и оно внутри function bandoAudioKick(){...}
    expect(out.match(/audio\.load\(\);/g)).toHaveLength(1);
    const fn = out.match(/function bandoAudioKick\(\)\{([\s\S]*?)\}/);
    expect(fn).toBeTruthy();
    expect(fn![1]).toContain("audio.load();");
    expect(fn![1]).toContain("audio.preload='auto';");
  });

  it("ставит маркеры pointerdown/keydown-обработчика (первый жест юзера)", () => {
    expect(out).toContain("bando-audio-defer");
    expect(out).toMatch(/addEventListener\('pointerdown',bandoAudioKick,true\)/);
    expect(out).toMatch(/addEventListener\('keydown',bandoAudioKick,true\)/);
  });

  it("идемпотентно — повторный вызов на уже пропатченном html ничего не меняет", () => {
    expect(skinRunnerAudioDefer(out)).toBe(out);
  });

  it("no-op на reading-html без #playOverlay (байт-в-байт)", () => {
    expect(skinRunnerAudioDefer(READING_HEAD)).toBe(READING_HEAD);
  });

  it("no-op на listening-подобном html без якоря audio.load() (незнакомое семейство)", () => {
    const noLoadAnchor =
      '<html><head></head><body><div id="playOverlay">gate</div>' +
      '<audio id="audio" src="a.mp3" preload="auto"></audio>' +
      "<script>audio.preload='auto';</script></body></html>";
    expect(skinRunnerAudioDefer(noLoadAnchor)).toBe(noLoadAnchor);
  });

  it("no-op на html без #playOverlay, даже если JS-якоря присутствуют", () => {
    const noGate =
      "<html><head></head><body>" +
      '<audio id="audio" src="a.mp3" preload="auto"></audio>' +
      "<script>audio.preload='auto';audio.load();</script></body></html>";
    expect(skinRunnerAudioDefer(noGate)).toBe(noGate);
  });

  it("две <audio preload=\"auto\"> — обе заменены на metadata", () => {
    const twoAudio =
      '<html><head></head><body><div id="playOverlay">gate</div>' +
      '<audio id="audio" src="a.mp3" preload="auto"></audio>' +
      '<audio id="audio2" src="b.mp3" preload="auto"></audio>' +
      "<script>audio.preload='auto';audio.load();</script></body></html>";
    const patched = skinRunnerAudioDefer(twoAudio);
    expect(patched.match(/preload="auto"/g)).toBeNull();
    expect(patched.match(/preload="metadata"/g)).toHaveLength(2);
  });
});

describe("skinRunnerAudioLabel", () => {
  const out = skinRunnerAudioLabel(listeningFixture);

  it("статус-строка «Downloading audio…» смягчена на «Preparing audio…» (реальная фикстура)", () => {
    expect(out).not.toContain("Downloading audio");
    expect(out).toContain("Preparing audio&hellip;");
  });

  it("JS-литерал markAudioReady('Download complete') смягчён на 'Audio ready'", () => {
    expect(out).not.toContain("'Download complete'");
    expect(out).toContain("'Audio ready'");
  });

  it("не трогает прочие тексты состояний и логику гейта", () => {
    expect(out).toContain("Ready to play (still buffering)");
    expect(out).toContain("Audio failed to load — check your connection.");
    // Play-гейт остаётся гейтом — никакого автоскрытия оверлея не добавлено.
    expect(out).toContain("playBtn.disabled=false");
  });

  it("идемпотентно — повторный вызов на уже пропатченном html ничего не меняет", () => {
    expect(skinRunnerAudioLabel(out)).toBe(out);
  });

  it("no-op байт-в-байт без #playOverlay (reading-раннер)", () => {
    expect(skinRunnerAudioLabel(READING_HEAD)).toBe(READING_HEAD);
  });

  it("естественный no-op, если искомых строк нет (гейт есть, текстов нет)", () => {
    const gateOnlyNoText =
      '<html><head></head><body><div id="playOverlay">gate</div>' +
      "<script>markAudioReady('Ready to play');</script></body></html>";
    expect(skinRunnerAudioLabel(gateOnlyNoText)).toBe(gateOnlyNoText);
  });

  it("толерантно к вариантам многоточия (... и …), не только &hellip;", () => {
    const dots =
      '<html><head></head><body><div id="playOverlay">' +
      '<span id="dlStatus">Downloading audio...</span></div></body></html>';
    const ellipsisChar =
      '<html><head></head><body><div id="playOverlay">' +
      '<span id="dlStatus">Downloading audio…</span></div></body></html>';
    expect(skinRunnerAudioLabel(dots)).toContain("Preparing audio&hellip;");
    expect(skinRunnerAudioLabel(dots)).not.toContain("Downloading audio");
    expect(skinRunnerAudioLabel(ellipsisChar)).toContain("Preparing audio&hellip;");
    expect(skinRunnerAudioLabel(ellipsisChar)).not.toContain("Downloading audio");
  });

  // Часовой контекстного сужения: те же строки ВНЕ разрешённых зон (текст пассажа/
  // транскрипта, посторонняя JS-переменная) обязаны остаться нетронутыми — гейт
  // #playOverlay подтверждает наличие оверлея, но зону замены ограничивают якоря
  // #dlStatus / markAudioReady(...). Сравниваем ВЕСЬ выход с ожидаемым, отличающимся
  // ровно двумя разрешёнными заменами.
  it("часовой: совпадения в контенте теста не тронуты — меняются ровно две зоны", () => {
    const contentPara =
      "<p>Transcript: the screen said Downloading audio... and then 'Download complete'.</p>";
    const foreignJs = "var x='Download complete';";
    const before =
      '<html><head></head><body><div id="playOverlay">' +
      '<span id="dlStatus">Downloading audio&hellip;</span></div>' +
      contentPara +
      `<script>${foreignJs}markAudioReady('Download complete');</script>` +
      "</body></html>";
    const after =
      '<html><head></head><body><div id="playOverlay">' +
      '<span id="dlStatus">Preparing audio&hellip;</span></div>' +
      contentPara +
      `<script>${foreignJs}markAudioReady('Audio ready');</script>` +
      "</body></html>";
    expect(skinRunnerAudioLabel(before)).toBe(after);
  });

  it("markAudioReady с двойными кавычками — замена работает, вид кавычек сохранён", () => {
    const dq =
      '<html><head></head><body><div id="playOverlay">gate</div>' +
      '<script>markAudioReady("Download complete");</script></body></html>';
    const patched = skinRunnerAudioLabel(dq);
    expect(patched).toContain('markAudioReady("Audio ready")');
    expect(patched).not.toContain("Download complete");
  });

  it("два вызова markAudioReady — заменены оба (глобальный флаг не потерян)", () => {
    const twice =
      '<html><head></head><body><div id="playOverlay">gate</div>' +
      "<script>markAudioReady('Download complete');" +
      "if(fast)markAudioReady('Download complete');</script></body></html>";
    const patched = skinRunnerAudioLabel(twice);
    expect(patched.match(/markAudioReady\('Audio ready'\)/g)).toHaveLength(2);
    expect(patched).not.toContain("Download complete");
  });
});

describe("skin-runner composition (route.ts pipeline order)", () => {
  // Сырая фикстура — ДО-импортный HTML без bridge.ts (его сплайсит sanitizeRunner при
  // импорте); чтобы injectProgressBridge распознал SEND/хвост, сплайсим LISTENING_BRIDGE
  // перед </body> — так же, как это делает реальный импорт-пайплайн.
  const fixtureWithBridge = listeningFixture.replace(
    "</body>",
    `${LISTENING_BRIDGE}\n</body>`,
  );

  it("полная цепочка как в route.ts: все маркеры соседей на месте, текст гейта смягчён", () => {
    const withBridge = injectProgressBridge(fixtureWithBridge);
    const out = skinRunnerAudioLabel(
      skinRunnerAudioDefer(skinRunnerBrand(skinRunnerGate(withBridge))),
    );
    expect(out).toContain("bando-gate-skin");
    expect(out).toContain("bando-audio-defer");
    expect(out).toContain("bando-progress-bridge");
    expect(out).not.toContain("Downloading audio");
    expect(out).toContain("Preparing audio&hellip;");
    expect(out).not.toContain("'Download complete'");
    expect(out).toContain("'Audio ready'");
    // route.ts завершает цепочку forceRunnerMode; фикстура — не семейство A/B (нет
    // pendingMode / mode-card-btn / mode-switcher) → контрактный fail-open no-op
    // байт-в-байт: label-выход не сбивает его детект.
    expect(forceRunnerMode(out, "mock", 60)).toBe(out);
  });

  it("порядок не важен: label ДО defer тоже даёт оба эффекта (текст смягчён + preload отложен)", () => {
    const labelFirst = skinRunnerAudioDefer(skinRunnerAudioLabel(listeningFixture));
    expect(labelFirst).toContain("Preparing audio&hellip;");
    expect(labelFirst).toContain("'Audio ready'");
    expect(labelFirst).toContain("bando-audio-defer");
    const audioTag = labelFirst.match(/<audio\b[^>]*>/i)?.[0] ?? "";
    expect(audioTag).toMatch(/preload="metadata"/);
  });

  // Часовой на якоря соседей: label — чисто текстовые замены, они НЕ должны задевать
  // ни смежную пару preload/load (якорь skinRunnerAudioDefer), ни хвосты bridge-IIFE
  // (якоря injectProgressBridge). Хвосты продублированы литерально из skin-runner.ts
  // (READING_TAIL/LISTENING_TAIL — приватные константы).
  it("label-патч не съедает якоря соседей: preload-якорь defer и хвосты bridge целы", () => {
    const labeled = skinRunnerAudioLabel(listeningFixture);
    expect(AUDIO_PRELOAD_JS_ANCHOR.test(labeled)).toBe(true);

    const labeledBridge = skinRunnerAudioLabel(fixtureWithBridge);
    expect(labeledBridge).toContain("__hook();\n})();</script>"); // LISTENING_TAIL
    // READING_TAIL: reading-bridge html без #playOverlay — label no-op, хвост цел.
    const readingBridgeHtml = `<html><head></head><body>${READING_BRIDGE}</body></html>`;
    expect(skinRunnerAudioLabel(readingBridgeHtml)).toContain(
      "window.showResults = function(){ __send(); };\n})();</script>", // READING_TAIL
    );
  });
});

// Поведенческая проверка самого инжектируемого JS-снипета (не строки, а рантайм-
// эффекта). Без jsdom (нет в инфре) — микро-харнесс через `new Function("audio",
// "document", snippet)`: снипет — готовое ES5-IIFE, `audio` внутри него резолвится
// по замыканию на параметр "audio" ЭТОЙ обёрточной функции (в реальном раннере —
// на переменную `audio`, объявленную раньше в том же script-теге). Стабы —
// vi.fn(), листенеры копятся в массиве.
describe("audioDeferredKickJs — поведение снипета (без jsdom)", () => {
  function makeHarness() {
    const audio = { preload: "auto", load: vi.fn() };
    const listeners: Array<{ type: string; handler: () => void; capture: boolean }> = [];
    const addEventListener = vi.fn((type: string, handler: () => void, capture: boolean) => {
      listeners.push({ type, handler, capture });
    });
    const removeEventListener = vi.fn();
    const document = { addEventListener, removeEventListener };
    const fn = new Function("audio", "document", audioDeferredKickJs());
    fn(audio, document);
    return { audio, document, listeners };
  }

  it("сразу preload='metadata', load() не вызван, зарегистрированы ровно 2 capture-листенера", () => {
    const { audio, document, listeners } = makeHarness();
    expect(audio.preload).toBe("metadata");
    expect(audio.load).not.toHaveBeenCalled();
    expect(document.addEventListener).toHaveBeenCalledTimes(2);
    expect(listeners).toHaveLength(2);
    expect(listeners.every((l) => l.capture === true)).toBe(true);
    expect(listeners.map((l) => l.type).sort()).toEqual(["keydown", "pointerdown"]);
  });

  it("по первому жесту: preload flip на 'auto', load() ровно 1 раз, оба листенера сняты теми же ссылками", () => {
    const { audio, document, listeners } = makeHarness();
    const pointerHandler = listeners.find((l) => l.type === "pointerdown")!.handler;
    const keydownHandler = listeners.find((l) => l.type === "keydown")!.handler;

    pointerHandler();

    expect(audio.preload).toBe("auto");
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(document.removeEventListener).toHaveBeenCalledTimes(2);
    expect(document.removeEventListener).toHaveBeenCalledWith("pointerdown", pointerHandler, true);
    expect(document.removeEventListener).toHaveBeenCalledWith("keydown", keydownHandler, true);
  });
});

// F2-минимал (волна E): периодический автосейв-мост iframe → parent. Фикстуры зеркалят
// РЕАЛЬНУЮ форму runner_html, которую производит sanitizeRunner (bridge прямо перед
// </body>), чтобы якорь по хвосту bridge-скрипта проверялся на настоящем тексте.
describe("injectProgressBridge", () => {
  const readingHtml = `<html><head></head><body><div id="q1"></div>\n${READING_BRIDGE}\n</body></html>`;
  const listeningHtml = `<html><head></head><body><div id="q1"></div>\n${LISTENING_BRIDGE}\n</body></html>`;

  it("инжектит мост внутрь reading bridge-IIFE (ДО закрытия, не отдельным <script>)", () => {
    const out = injectProgressBridge(readingHtml);
    expect(out).toContain("bando-progress-bridge");
    expect(out).toContain("ielts-progress");
    // Переиспользует __collect() бриджа, не дублирует селекторный сбор ответов.
    expect(out).toContain("__collect()");
    expect(out.match(/function __readingMultiFor/g)?.length).toBe(1); // не задвоен
    // Внутри ТОЙ ЖЕ IIFE: наш код стоит раньше закрывающего "})();</script>".
    expect(out.indexOf("ielts-progress")).toBeLessThan(out.lastIndexOf("})();</script>"));
    expect(out.indexOf("ielts-progress")).toBeGreaterThan(out.indexOf("function __collect"));
  });

  it("инжектит мост внутрь listening bridge-IIFE", () => {
    const out = injectProgressBridge(listeningHtml);
    expect(out).toContain("bando-progress-bridge");
    expect(out).toContain("ielts-progress");
    expect(out).toContain("__collect()");
    expect(out.match(/function __multiFor/g)?.length).toBe(1); // не задвоен
    expect(out.indexOf("ielts-progress")).toBeLessThan(out.lastIndexOf("})();</script>"));
    expect(out.indexOf("ielts-progress")).toBeGreaterThan(out.indexOf("function __collect"));
  });

  it("шлёт только при непустых ответах и не спамит повтор — снапшот-гейт в самом снипете", () => {
    const out = injectProgressBridge(readingHtml);
    expect(out).toContain("__hasAnswers");
    expect(out).toContain("__lastProgress");
    expect(out).toMatch(/setInterval\(__sendProgress,\s*12000\)/);
    expect(out).toMatch(/setTimeout\(__sendProgress,\s*2000\)/);
  });

  it("идемпотентен — повторный вызов не задваивает инжект", () => {
    const once = injectProgressBridge(readingHtml);
    expect(injectProgressBridge(once)).toBe(once);
  });

  it("no-op без распознанного SEND (не наш bridge / чужой контент)", () => {
    const noBridge = "<html><head></head><body><div>plain</div></body></html>";
    expect(injectProgressBridge(noBridge)).toBe(noBridge);
  });

  it("no-op когда SEND есть, но хвост bridge не распознан (частичный патч опаснее no-op)", () => {
    const mutatedTail = `<html><head></head><body>${SEND_MARKER_ONLY}\n</body></html>`;
    expect(injectProgressBridge(mutatedTail)).toBe(mutatedTail);
  });
});

// Синтетический SEND-фрагмент без узнаваемого reading/listening хвоста — имитирует
// гипотетический незнакомый bridge-вариант с тем же protocol-маркером ielts-submit.
const SEND_MARKER_ONLY =
  "<script>(function(){function __send(ans){ parent.postMessage({ type: 'ielts-submit', answers: ans }, '*'); } window.__unknownHook = __send; })();</script>";
