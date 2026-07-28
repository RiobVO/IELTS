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

const READING_KEYS = ["correctAnswers", "acceptableAnswers", "explanations", "evidence", "questionTypes"];
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
 */
export function assertNoKeyLeak(out: string, parsed: ParsedTest): void {
  const $ = cheerio.load(out);
  const script = $("script:not([src])")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");

  for (const q of parsed.questions) {
    for (const a of q.answer.accept) {
      const needle = String(a).trim();
      const low = needle.toLowerCase();
      if (low.length < 3) continue; // одиночные буквы / короткие числа
      if (FIXED_CHOICE.test(low)) continue; // фиксированные опции — видимы и так
      if (/^\d+$/.test(low)) continue; // чистые числа — видимы / тривиальны
      // ответ как точный строковый литерал ("x" / 'x' / `x`) => объект-ключ не вырезан
      const re = new RegExp(`(["'\`])\\s*${escapeRegex(needle)}\\s*\\1`, "i");
      if (re.test(script)) {
        throw new Error(`Key leak: answer "${a}" (q${q.number}) found as a string literal in runner_html script`);
      }
    }
  }
}
