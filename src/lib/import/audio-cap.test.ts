import { describe, it, expect } from "vitest";
import {
  MAX_IMPORT_AUDIO_BYTES,
  MAX_IMPORT_AUDIO_MB,
  withinAudioCap,
  audioTooLargeMessage,
} from "./audio-cap";

describe("withinAudioCap", () => {
  it("пропускает файл строго меньше лимита", () => {
    expect(withinAudioCap(MAX_IMPORT_AUDIO_BYTES - 1)).toBe(true);
    expect(withinAudioCap(0)).toBe(true);
    expect(withinAudioCap(5 * 1024 * 1024)).toBe(true);
  });

  it("пропускает файл ровно на границе (лимит включителен, 12 MB)", () => {
    expect(withinAudioCap(MAX_IMPORT_AUDIO_BYTES)).toBe(true);
    expect(withinAudioCap(12 * 1024 * 1024)).toBe(true);
  });

  it("отсекает файл строго больше лимита (12 MB + 1 байт)", () => {
    expect(withinAudioCap(MAX_IMPORT_AUDIO_BYTES + 1)).toBe(false);
    expect(withinAudioCap(12 * 1024 * 1024 + 1)).toBe(false);
    expect(withinAudioCap(40 * 1024 * 1024)).toBe(false);
  });
});

describe("audioTooLargeMessage", () => {
  it("несёт вес файла, лимит и actionable-инструкцию", () => {
    const msg = audioTooLargeMessage(12 * 1024 * 1024);
    expect(msg).toContain("12.0 MB");
    expect(msg).toContain(`${MAX_IMPORT_AUDIO_MB} MB`);
    expect(msg).toMatch(/пережми mp3/);
    expect(msg).toMatch(/mono, 48 kbps, 32 kHz/);
    expect(msg).toMatch(/пришли снова/);
  });

  it("округляет размер до одного знака после запятой", () => {
    // 12.5 MB ровно
    expect(audioTooLargeMessage(Math.round(12.5 * 1024 * 1024))).toContain("12.5 MB");
  });
});
