// Юнит-тесты авто-детекта метаданных каталога (migration 0025). Кейсы — реальные
// формулировки Task 2 из живого набора промтов: детект должен быть стабилен на них
// и мягко падать в дефолты (society / opinion) на незнакомом тексте.
import { describe, it, expect } from "vitest";
import {
  coerceDifficulty,
  coerceTaskType,
  coerceTopic,
  detectTaskType,
  detectTopic,
} from "./topic-meta";

describe("detectTaskType", () => {
  it("'Discuss both views' → discussion", () => {
    expect(detectTaskType("Some say X, others say Y. Discuss both views and give your own opinion.")).toBe("discussion");
  });
  it("'outweigh the disadvantages' → adv_disadv", () => {
    expect(detectTaskType("Do the advantages outweigh the disadvantages?")).toBe("adv_disadv");
  });
  it("'positive or negative development' → pos_neg", () => {
    expect(detectTaskType("Is this a positive or negative development?")).toBe("pos_neg");
  });
  it("'to what extent do you agree' → agree_disagree", () => {
    expect(detectTaskType("To what extent do you agree or disagree?")).toBe("agree_disagree");
  });
  it("две части (два вопроса) → two_part", () => {
    expect(detectTaskType("Why is this happening? How should they be punished?")).toBe("two_part");
  });
  it("незнакомая формулировка → opinion (дефолт)", () => {
    expect(detectTaskType("Write about your favourite season.")).toBe("opinion");
  });
});

describe("detectTopic", () => {
  it("'fast food' wins over generic — food, не environment", () => {
    expect(detectTopic("Traditional foods are being replaced by international fast food.")).toBe("food");
  });
  it("'food packaging' как мусор → environment, не food", () => {
    expect(detectTopic("Household waste such as food packaging is increasing day by day.")).toBe("environment");
  });
  it("crime → crime", () => {
    expect(detectTopic("Children and teenagers are committing more crimes. How should they be punished?")).toBe("crime");
  });
  it("technology → technology", () => {
    expect(detectTopic("Some people believe that technology has made life more complex.")).toBe("technology");
  });
  it("multinational/cultures → culture", () => {
    expect(detectTopic("The best way to understand other cultures is to work for a multinational organization.")).toBe("culture");
  });
  it("общий/абстрактный промт → society (catch-all)", () => {
    expect(detectTopic("Some people think a university education is the key to success.")).toBe("society");
  });
});

describe("coerce helpers", () => {
  it("coerceTopic пропускает только из набора", () => {
    expect(coerceTopic("crime")).toBe("crime");
    expect(coerceTopic("space")).toBeNull();
    expect(coerceTopic(null)).toBeNull();
  });
  it("coerceTaskType пропускает только из набора", () => {
    expect(coerceTaskType("two_part")).toBe("two_part");
    expect(coerceTaskType("essay")).toBeNull();
  });
  it("coerceDifficulty принимает 1|2|3 (строку и число), иначе null", () => {
    expect(coerceDifficulty("2")).toBe(2);
    expect(coerceDifficulty(3)).toBe(3);
    expect(coerceDifficulty(0)).toBeNull();
    expect(coerceDifficulty(null)).toBeNull();
  });
});
