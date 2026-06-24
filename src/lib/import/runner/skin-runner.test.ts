import { describe, it, expect } from "vitest";
import { skinRunnerGate } from "./skin-runner";

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
