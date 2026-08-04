/**
 * Банк вопросов публичного Band Predictor (`/predictor`, G1-6). SERVER-ONLY.
 *
 * ПОЧЕМУ СВОЙ ТЕКСТ, А НЕ ТЕСТ ИЗ КАТАЛОГА. Предиктор открыт без регистрации и
 * индексируется — публиковать там лицензионный материал клиента нельзя, да и
 * «сжигать» реальный тест на гостях незачем: первый настоящий мок должен остаться
 * первым. Пассажи и вопросы написаны для этой воронки, в формате академического
 * Reading, но своим текстом.
 *
 * ПОЧЕМУ SERVER-ONLY. В отличие от онбординговой мини-диагностики (та грейдится на
 * клиенте, потому что живёт ЗА логином и ничего не решает), этот банк уходит в
 * открытый интернет. Правильные ответы обязаны остаться на сервере — клиент
 * получает только `PublicQuestion` (см. toPublic), где поля `answer` нет физически.
 */
import "server-only";

export type PredictorQType = "tfng" | "sentence_completion" | "mcq_single" | "short_answer";

export interface PredictorQuestion {
  number: number;
  passage: 1 | 2;
  qtype: PredictorQType;
  prompt: string;
  /** Варианты для tfng/mcq_single. Отсутствуют → свободный ввод. */
  options?: string[];
  /** Принимаемые ответы; сравнение — без учёта регистра и лишних пробелов. */
  accept: string[];
}

/** То, что реально уходит в браузер: без единого правильного ответа. */
export interface PublicQuestion {
  number: number;
  passage: 1 | 2;
  qtype: PredictorQType;
  prompt: string;
  options?: string[];
}

export const PREDICTOR_PASSAGES: Record<1 | 2, { title: string; body: string }> = {
  1: {
    title: "The city that cools itself",
    body: `When Seville recorded its hottest summer on record, the city did not reach for air conditioning. Engineers instead revived a technique older than the machinery: they pumped water through a lattice of pipes buried four metres beneath a public square, where the soil stays near eighteen degrees all year. Air drawn through those pipes lost several degrees before it surfaced through vents shaded by canvas sails. On the worst afternoons, visitors to the square measured temperatures ten degrees lower than on the street outside.

The scheme was not cheap, and its designers are careful about what they claim. Cooling one square does nothing for the districts where most residents actually live, and the pumps still draw electricity, though a fraction of what conventional cooling would demand. What the project did change was the argument. Before it opened, the assumption in most southern European councils was that surviving hotter summers meant installing more machines. Seville's square suggested that shade, water and the steady temperature of the ground could do a share of the work, and that the cheapest degree of cooling is the one a city never has to generate.`,
  },
  2: {
    title: "Why forecasts of the future keep failing",
    body: `Forecasters have a poor record, and the reason is rarely a lack of data. In the 1970s, panels of experts predicted that offices would be paperless within a decade; paper consumption promptly doubled. The error was not arithmetic. It came from assuming that a new technology replaces an old habit, when in practice it usually multiplies the occasions for that habit.

Researchers who study prediction find that accuracy improves under two unglamorous conditions. The first is a scoring rule: forecasters who must state a probability, then have it checked, revise their views faster than those who speak in adjectives. The second is a habit of updating in small steps. The forecasters with the best records were not the boldest; they changed their minds often and slightly, treating each new fact as a nudge rather than a verdict.

None of this makes the future legible. It does suggest that the useful question is not who predicted a given event, which anyone can do by chance, but whose predictions have been least wrong across many attempts.`,
  },
};

/**
 * Десять вопросов, четыре типа. Порядок фиксирован (номер = позиция) — витрина
 * результата ссылается на номера, а перемешивание не даёт ничего, кроме
 * невоспроизводимых жалоб.
 */
export const PREDICTOR_QUESTIONS: PredictorQuestion[] = [
  {
    number: 1,
    passage: 1,
    qtype: "tfng",
    prompt: "Seville's cooling system relies on water passing through pipes below ground.",
    options: ["TRUE", "FALSE", "NOT GIVEN"],
    accept: ["TRUE"],
  },
  {
    number: 2,
    passage: 1,
    qtype: "tfng",
    prompt: "The square's cooling system uses no electricity at all.",
    options: ["TRUE", "FALSE", "NOT GIVEN"],
    accept: ["FALSE"],
  },
  {
    number: 3,
    passage: 1,
    qtype: "tfng",
    prompt: "The designers plan to build the same system in every district of the city.",
    options: ["TRUE", "FALSE", "NOT GIVEN"],
    accept: ["NOT GIVEN"],
  },
  {
    number: 4,
    passage: 1,
    qtype: "sentence_completion",
    prompt: "Four metres underground, the soil stays close to ______ degrees throughout the year.",
    accept: ["eighteen", "18"],
  },
  {
    number: 5,
    passage: 1,
    qtype: "short_answer",
    prompt: "What material shades the vents where the cooled air reaches the surface? (ONE WORD)",
    accept: ["canvas", "canvas sails", "sails"],
  },
  {
    number: 6,
    passage: 2,
    qtype: "mcq_single",
    prompt: "The paperless-office prediction failed mainly because forecasters assumed that:",
    options: [
      "new technology replaces an existing habit",
      "offices would resist buying new machines",
      "paper would become more expensive",
    ],
    accept: ["new technology replaces an existing habit"],
  },
  {
    number: 7,
    passage: 2,
    qtype: "mcq_single",
    prompt: "According to the passage, forecasters improve fastest when they:",
    options: [
      "state probabilities that are later checked",
      "describe outcomes in careful adjectives",
      "wait for more complete data",
    ],
    accept: ["state probabilities that are later checked"],
  },
  {
    number: 8,
    passage: 2,
    qtype: "mcq_single",
    prompt: "The passage suggests the most useful question about a forecaster is:",
    options: [
      "how wrong their predictions have been over many attempts",
      "whether they predicted one famous event",
      "how confidently they state their views",
    ],
    accept: ["how wrong their predictions have been over many attempts"],
  },
  {
    number: 9,
    passage: 2,
    qtype: "sentence_completion",
    prompt: "The best forecasters changed their minds often and ______.",
    accept: ["slightly"],
  },
  {
    number: 10,
    passage: 2,
    qtype: "short_answer",
    prompt: "What happened to paper consumption after the paperless-office prediction? It ______. (ONE WORD)",
    accept: ["doubled"],
  },
];

/** Публичная проекция вопроса — единственное, что позволено отдать браузеру. */
export function toPublic(q: PredictorQuestion): PublicQuestion {
  return {
    number: q.number,
    passage: q.passage,
    qtype: q.qtype,
    prompt: q.prompt,
    ...(q.options ? { options: q.options } : {}),
  };
}

export const PUBLIC_QUESTIONS: PublicQuestion[] = PREDICTOR_QUESTIONS.map(toPublic);
