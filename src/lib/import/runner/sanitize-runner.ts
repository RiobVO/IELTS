import * as cheerio from "cheerio";
import { extractObjectLiteral } from "../extract-js";
import { READING_BRIDGE, LISTENING_BRIDGE } from "./bridge";
import type { ParsedTest } from "../types";

export interface SanitizeOpts {
  contentItemId: string;
  section: "reading" | "listening";
  /** Наш Storage URL для перезалитого аудио (listening). */
  audioUrl?: string;
}

// mcqGroups несёт correct-набор букв (#7) — буквы короче 3 символов бэкстоп
// пропускает, поэтому объект обязан вырезаться целиком (N1). acceptableVariants —
// альтернативное имя контейнера вариантов у источника Vol7/Mock (QA 2026-07-02).
const READING_KEYS = ["correctAnswers", "acceptableAnswers", "acceptableVariants", "mcqGroups", "explanations", "evidence", "questionTypes"];
// listening evidence.text перефразирует/содержит ответ — вырезаем его тоже (иначе утечка).
const LISTENING_KEYS = ["KEY", "QTYPE", "evidence"];

/** Подменяет первый `<audio ... src="...">` на наш Storage URL (listening). */
export function setRunnerAudioSrc(html: string, url: string): string {
  return html.replace(/(<audio[^>]*\ssrc=)(["'])[^"']*\2/i, `$1$2${url}$2`);
}

/** Заменяет `const NAME = {...}` на `const NAME = {}` (балансировка из extract-js). */
function blankObject(src: string, name: string): string {
  const literal = extractObjectLiteral(src, name);
  if (literal == null) return src;
  return src.replace(literal, "{}");
}

/** Заменяет тело `function NAME(...){...}` на заглушку `return 0`. */
function blankFunction(src: string, name: string): string {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return src;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(0, m.index) + `function ${name}(){return 0;}` + src.slice(i);
}

export function sanitizeRunner(html: string, opts: SanitizeOpts): string {
  let out = html;

  // 1. Вырезать ключи + band-функции
  const keys = opts.section === "reading" ? READING_KEYS : LISTENING_KEYS;
  for (const name of keys) out = blankObject(out, name);
  for (const fn of ["band", "getBand", "getBandFor40"]) out = blankFunction(out, fn);

  // 2. Подменить audio src (listening)
  if (opts.section === "listening" && opts.audioUrl) {
    out = setRunnerAudioSrc(out, opts.audioUrl);
  }

  // 3. Уникализировать STORAGE_KEY (+ HIGHLIGHT_STORAGE_KEY если есть)
  out = out.replace(
    /((?:const|let|var)\s+(?:STORAGE_KEY|HIGHLIGHT_STORAGE_KEY)\s*=\s*)(["'])([^"']*)\2/g,
    (_m, decl, q, val) => `${decl}${q}${val}__${opts.contentItemId}${q}`,
  );

  // 4. Удалить внешний html2pdf <script src> и нейтрализовать его вызовы.
  // PDF-экспорт нам не нужен (spec §10): сносим CDN-скрипт, а оставшиеся вызовы
  // `html2pdf()` переименовываем в chainable no-op (иначе клик по кнопке PDF
  // упал бы с ReferenceError). Шим определяется ниже, перед </body>.
  out = out.replace(/<script[^>]*html2pdf[^>]*>\s*<\/script>/gi, "");
  out = out.replace(/\bhtml2pdf\b/g, "__noPdf");

  // 5. Инжектить no-op PDF-шим + мост перед </body>
  const bridge = opts.section === "reading" ? READING_BRIDGE : LISTENING_BRIDGE;
  out = out.replace(/<\/body>/i, `${NOPDF_SHIM}\n${bridge}\n</body>`);

  return out;
}

// Chainable no-op, замещающий html2pdf (PDF-экспорт отключён).
const NOPDF_SHIM =
  "<script>window.__noPdf=function(){var c={set:function(){return c;}," +
  "from:function(){return c;},save:function(){return Promise.resolve();}," +
  "then:function(cb){try{if(cb)cb();}catch(e){}return c;},catch:function(){return c;}," +
  "outputPdf:function(){return Promise.resolve();}};return c;};</script>";

// Фиксированные опции, которые студент и так видит в разметке (radio/checkbox).
// Их присутствие в коде утечкой НЕ является — правильный вариант не выделен.
const FIXED_CHOICE = /^(true|false|not given|yes|no)$/i;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Гейт анти-утечки (spec §4 шаг 4 / §9 риск 1): ни один ответ из answer_key не
 * должен остаться в СКРИПТ-СЕКЦИИ очищенного файла как СТРОКОВЫЙ ЛИТЕРАЛ. Только в
 * <script> (не во всём HTML): completion-ответы reading легитимно есть в ТЕКСТЕ
 * пассажа — студент их читает, это не утечка. И именно литерал ("ten"/'ten'), а не
 * подстрока/слово: так ключи лежат в JS-объектах (correctAnswers/KEY/...), поэтому
 * невырезанный объект ловится; а обычное слово-ответ в комментарии ("// safety net")
 * или UI-строке ('strong, even…') в кавычки-как-целый-литерал не попадает — ложного
 * срабатывания нет. Fixed-choice (TRUE/FALSE/YES/NO/буквы/числа) пропускаем — они
 * видимы в опциях, их «утечка» не выдаёт правильный вариант.
 *
 * Пропуски (короткие/числа/fixed-choice) безопасны ТОЛЬКО пока ключ лежит в
 * распознанных объектах — их вырезает sanitizeRunner. Поэтому два структурных
 * слоя до пословной проверки (N1, AUDIT_2026-07-02): (1) известные key-объекты
 * секции обязаны быть пустыми литералами (ловит регресс списка и дубль-декларацию —
 * blankObject бьёт только первую); (2) любой НЕраспознанный объект, похожий на
 * карту «номер вопроса → значение», роняет импорт — ключ под чужим именем
 * (новый источник) иначе прошёл бы молча через пропуск коротких/чисел.
 */
const MIN_NUMERIC_KEYS = 4; // реальные key-map ≥7 записей; ниже — не карта ответов
// Ключ-«номер вопроса»: 1-3 цифры или диапазон "8-12", в кавычках или без.
// Кавычка требует пары ДО двоеточия — иначе время в строках ("12:30") ложно матчится.
// Значение обязано быть строкой/массивом (форма ответа): числовой ключ с ОБЪЕКТОМ-
// значением — это UI-конфиг секций (partConfig, QA 2026-07-02), не карта ответов.
const NUM_KEY_RE = /(?:^|[{,\s])(?:(["'])\d{1,3}(?:-\d{1,3})?\1|\d{1,3})\s*:\s*["'`\[]/g;

export function assertNoKeyLeak(out: string, parsed: ParsedTest): void {
  const $ = cheerio.load(out);
  const script = $("script:not([src])")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");

  const known = parsed.section === "reading" ? READING_KEYS : LISTENING_KEYS;

  // Слой 1: каждый известный key-объект — пустой литерал во ВСЕХ декларациях.
  for (const name of known) {
    const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, "g");
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(script)) !== null) {
      const lit = extractObjectLiteral(script.slice(m.index), name);
      if (lit && lit.replace(/\s/g, "") !== "{}") {
        throw new Error(`Key leak: object "${name}" survived sanitization in runner_html script`);
      }
    }
  }

  // Слой 2: нераспознанные объекты-карты с числовыми ключами.
  const anyDeclRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let dm: RegExpExecArray | null;
  while ((dm = anyDeclRe.exec(script)) !== null) {
    const name = dm[1]!;
    if (known.includes(name)) continue; // слой 1 уже проверил
    const lit = extractObjectLiteral(script.slice(dm.index), name);
    if (!lit) continue;
    const numericKeys = lit.match(NUM_KEY_RE)?.length ?? 0;
    if (numericKeys >= MIN_NUMERIC_KEYS) {
      throw new Error(
        `Key leak: unrecognized numeric key-map "${name}" (${numericKeys} keys) in runner_html script`,
      );
    }
  }

  for (const q of parsed.questions) {
    for (const a of q.answer.accept) {
      const needle = String(a).trim();
      const low = needle.toLowerCase();
      if (low.length < 3) continue; // одиночные буквы / короткие числа
      if (FIXED_CHOICE.test(low)) continue; // фиксированные опции — видимы и так
      if (/^\d+$/.test(low)) continue; // чистые числа — видимы / тривиальны
      // Ответ как ТОЧНЫЙ строковый литерал ("x" / 'x' / `x`) => объект-ключ не вырезан.
      // Без \s*-паддинга: UI-строка ' Evidence' (лейбл) ложно матчилась как ответ
      // "evidence" (Vol5 T10, QA 2026-07-02); ключи в объектах паддинга не несут.
      const re = new RegExp(`(["'\`])${escapeRegex(needle)}\\1`, "i");
      if (re.test(script)) {
        throw new Error(`Key leak: answer "${a}" (q${q.number}) found as a string literal in runner_html script`);
      }
    }
  }
}
