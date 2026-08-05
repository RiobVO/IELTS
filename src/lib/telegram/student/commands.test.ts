// Разбор входящего от студенческого бота (G2-1). Это граница доверия: и текст, и
// callback_data приходят от произвольного человека в интернете, поэтому «не наше»
// обязано отбраковываться ДО обращения к БД.
import { describe, it, expect } from "vitest";
import {
  buildDailyQuestionCallback,
  parseCommand,
  parseDailyQuestionCallback,
} from "./commands";
import { parseStartPayload, buildDeepLink } from "./link-code";

const UUID = "3f1c2a6e-9b4d-4c7a-8e21-55aa77bb99cc";

describe("parseCommand", () => {
  it("узнаёт команды и игнорирует регистр хвоста", () => {
    expect(parseCommand("/start")).toBe("start");
    expect(parseCommand("/stop")).toBe("stop");
    expect(parseCommand("/help")).toBe("help");
    expect(parseCommand("/question")).toBe("question");
  });

  it("срезает @botname, который Telegram дописывает в группах", () => {
    expect(parseCommand("/stop@bando_study_bot")).toBe("stop");
  });

  it("обычный текст командой не считается", () => {
    expect(parseCommand("true")).toBe("none");
    expect(parseCommand("")).toBe("none");
    expect(parseCommand(null)).toBe("none");
    expect(parseCommand("stop")).toBe("none");
  });
});

describe("parseStartPayload", () => {
  it("достаёт код привязки", () => {
    expect(parseStartPayload("/start Ab3-_xyz12345")).toBe("Ab3-_xyz12345");
  });

  it("/start без кода — это не привязка", () => {
    expect(parseStartPayload("/start")).toBeNull();
    expect(parseStartPayload("/start   ")).toBeNull();
  });

  it("мусор вместо кода не идёт в запрос к БД", () => {
    expect(parseStartPayload("/start ../../etc/passwd")).toBeNull();
    expect(parseStartPayload("/start short")).toBeNull();
    expect(parseStartPayload("/start " + "x".repeat(200))).toBeNull();
    expect(parseStartPayload("/help code12345678")).toBeNull();
  });
});

describe("parseDailyQuestionCallback", () => {
  it("разбирает свою кнопку", () => {
    expect(parseDailyQuestionCallback(`dq:${UUID}:12:2`)).toEqual({
      contentItemId: UUID,
      questionNumber: 12,
      optionIndex: 2,
    });
  });

  it("round-trip со сборкой не теряет полей", () => {
    const cb = { contentItemId: UUID, questionNumber: 7, optionIndex: 0 };
    expect(parseDailyQuestionCallback(buildDailyQuestionCallback(cb))).toEqual(cb);
  });

  it("укладывается в 64-байтный лимит Telegram", () => {
    const data = buildDailyQuestionCallback({
      contentItemId: UUID,
      questionNumber: 40,
      optionIndex: 9,
    });
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("отбраковывает чужое и битое", () => {
    expect(parseDailyQuestionCallback("publish:" + UUID)).toBeNull();
    expect(parseDailyQuestionCallback(`dq:not-a-uuid:1:0`)).toBeNull();
    expect(parseDailyQuestionCallback(`dq:${UUID}:0:0`)).toBeNull();
    expect(parseDailyQuestionCallback(`dq:${UUID}:1:-1`)).toBeNull();
    expect(parseDailyQuestionCallback(`dq:${UUID}:1`)).toBeNull();
    expect(parseDailyQuestionCallback(null)).toBeNull();
  });
});

describe("buildDeepLink", () => {
  it("собирает ссылку и экранирует код", () => {
    expect(buildDeepLink("bando_study_bot", "a-b_c")).toBe(
      "https://t.me/bando_study_bot?start=a-b_c",
    );
  });

  it("без имени бота ссылки нет — вместо битой t.me/null", () => {
    expect(buildDeepLink(null, "abc")).toBeNull();
  });
});
