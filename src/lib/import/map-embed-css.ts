/**
 * Санитайзер CSS для srcdoc map-embed'а (`capture-listening` шаг 6).
 *
 * Почему отдельный модуль с ПАРСЕРОМ, а не набор regex'ов в capture-sanitize:
 * ревью 2026-08-11 дважды пробило regex-подход — `\63ontent:"\41nswer" "\3a  B"`
 * (CSS-escape в ИМЕНИ свойства + разрезание строки), `.mp[data-label="content:map"]`
 * (двоеточие внутри строки принималось за декларацию), `u\72l(…)`/`@import`
 * (сетевые запросы). Блоклист на такой поверхности проигрывает по построению,
 * поэтому здесь: escape-декодирование → строко-осведомлённый разбор → ПЕРЕСБОРКА
 * из allowlist'а. Всё, что не распознано как безопасная декларация, не переживает
 * пересборку — включая формы, о которых мы не подумали.
 *
 * Модель доверия: embed рендерится в sandbox-iframe БЕЗ allow-scripts, поэтому
 * скрипты не в счёт; ловим (а) отрисовку ответа текстом (`content`), (б) сетевые
 * маяки (`url()`/`@import`), (в) выход из `<style>` в HTML srcdoc.
 */

/** Свойства, которым позволено пережить пересборку (CSS-рисунок карты + типографика). */
const ALLOWED_PROPS = new Set([
  // раскладка
  "position", "top", "right", "bottom", "left", "inset", "z-index", "display", "float", "clear",
  "width", "min-width", "max-width", "height", "min-height", "max-height", "box-sizing",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "overflow", "overflow-x", "overflow-y", "visibility", "aspect-ratio",
  // flex/grid
  "flex", "flex-basis", "flex-direction", "flex-grow", "flex-shrink", "flex-wrap", "gap",
  "row-gap", "column-gap", "align-items", "align-self", "align-content",
  "justify-content", "justify-items", "justify-self", "place-items", "place-content",
  "grid", "grid-column", "grid-row", "grid-template", "grid-template-columns",
  "grid-template-rows", "grid-template-areas", "grid-area", "order",
  // фон/рамки/тени
  "background", "background-color", "background-image", "background-size",
  "background-position", "background-repeat", "background-clip", "border", "border-top",
  "border-right", "border-bottom", "border-left", "border-color", "border-style",
  "border-width", "border-radius", "border-collapse", "border-spacing", "box-shadow",
  "outline", "outline-offset", "opacity",
  // текст
  "color", "font", "font-family", "font-size", "font-style", "font-weight",
  "font-variant-numeric", "line-height", "letter-spacing", "word-spacing", "text-align",
  "text-decoration", "text-transform", "text-shadow", "text-overflow", "white-space",
  "word-break", "overflow-wrap", "vertical-align", "list-style", "direction", "writing-mode",
  // трансформы/прочее оформление
  "transform", "transform-origin", "rotate", "scale", "translate", "cursor", "user-select",
  "pointer-events", "color-scheme", "table-layout", "caption-side",
  // SVG-рисунок (компас/дороги)
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin",
  // текстовое содержимое псевдоэлементов — ТОЛЬКО инертное (см. isInertContentValue)
  "content",
]);

/**
 * Функции/схемы, недопустимые в значении ГДЕ УГОДНО (даже внутри строки — в CSS-карте
 * им взяться неоткуда, а строка легко становится значением через var()).
 */
const VALUE_FORBIDDEN = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|data:/i;

/**
 * Структурные символы, недопустимые ВНЕ строк: `;` вне строки дописал бы соседнюю
 * декларацию при пересборке, `<`/`>` — вырвались бы из `<style>`, `@`/`{`/`}` —
 * подменили бы правило. Внутри кавычек они безобидны (`font-family:"A;B"`).
 */
const VALUE_STRUCTURAL = /[;<>{}@]/;

/**
 * Декодирование CSS-escape'ов: `\41`/`\0041 `/`\a` (hex + опциональный пробел) и
 * `\x` (любой символ). Нужно ДО анализа — иначе `\63ontent` не опознаётся как
 * `content`, а `"\41nswer"` не читается как «Answer» (ревью 2026-08-11, блокер 3).
 */
export function decodeCssEscapes(s: string): string {
  return s.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(.))/gs, (_m, hex: string | undefined, ch: string | undefined) => {
    if (hex != null) {
      const cp = Number.parseInt(hex, 16);
      // Суррогаты/вне-диапазона/NUL → U+FFFD (как требует CSS-спека).
      if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
      return String.fromCodePoint(cp);
    }
    return ch ?? "";
  });
}

/**
 * Строко-осведомлённое разбиение на декларации по `;` — `font-family:"A;B";top:0`
 * остаётся двумя декларациями, а не рвётся посреди строки (ревью, LOW).
 */
function splitDeclarations(block: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: string | null = null;
  let depth = 0;
  for (const ch of block) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Инертные значения `content`: none/normal либо ОДНА строка ≤3 символов без букв,
 * цифр и кавычек — стрелки/символы легитимной карты (Day 6: `content:"→"`) живут,
 * любой текст (в т.ч. склеенный из нескольких строк или из `var()`) — нет.
 */
function isInertContentValue(val: string): boolean {
  const v = val.trim().replace(/\s*!important\s*$/i, "");
  if (/^(none|normal)$/i.test(v)) return true;
  const m = /^(["'])([\s\S]*)\1$/.exec(v);
  if (!m) return false;
  return m[2].length <= 3 && !/[A-Za-z0-9\\&"'<>]/.test(m[2]);
}

/**
 * Одна декларация → безопасная `prop:value` или null.
 * Кастом-свойства (`--x`) разрешены (Day 6 держит в них ВСЮ палитру карты), но
 * только без строковых значений: строка в кастом-свойстве — это заготовка текста
 * для `content:var(--x)`, а не цвет (тот же ревью, вектор индирекции).
 */
function sanitizeDeclaration(decl: string): string | null {
  const i = decl.indexOf(":");
  if (i < 0) return null;
  const prop = decodeCssEscapes(decl.slice(0, i)).trim().toLowerCase();
  const value = decodeCssEscapes(decl.slice(i + 1)).trim();
  if (!prop || !value) return null;
  if (VALUE_FORBIDDEN.test(value) || !structurallySafeValue(value)) return null;
  if (prop.startsWith("--")) {
    if (!/^--[\w-]+$/.test(prop) || /["']/.test(value)) return null;
    return `${prop}:${value}`;
  }
  // Вендорные префиксы отбрасываем целиком: их поведение вне allowlist'а.
  if (!ALLOWED_PROPS.has(prop)) return null;
  if (prop === "content" && !isInertContentValue(value)) return null;
  if (HIDING_DECLARATION[prop]?.test(value.replace(/\s*!important\s*$/i, ""))) return null;
  return `${prop}:${value}`;
}

/**
 * Декларации, ПРЯЧУЩИЕ содержимое. Запрещены внутри embed'а осознанно: пока в карте
 * нельзя ничего спрятать, «что видит сканер текста — то видит и студент». Иначе
 * порционная обфускация (`<span>Correct an</span><i class="hidden">x</i><span>swer</span>`)
 * рисует чистый ключ, оставаясь невидимой для конкатенации текста (ревью 2026-08-11,
 * третий заход). Карта — это подписи зданий и улиц; прятать их незачем.
 */
const HIDING_DECLARATION: Record<string, RegExp> = {
  display: /^\s*none\s*$/i,
  visibility: /^\s*(hidden|collapse)\s*$/i,
  opacity: /^\s*0*(\.0+)?\s*$/,
  "font-size": /^\s*0(px|pt|em|rem|%)?\s*$/i,
  color: /^\s*transparent\s*$/i,
  "text-indent": /^\s*-/,
};

/**
 * Значение структурно безопасно: кавычки сбалансированы (иначе пересборка склеила бы
 * соседние декларации в одну строку) и запрещённых структурных символов нет ВНЕ строк.
 */
function structurallySafeValue(value: string): boolean {
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (VALUE_STRUCTURAL.test(ch)) return false;
  }
  return quote === null;
}

/** Селектор безопасен, если после декодирования не несёт разметку/at-правила. */
function safeSelector(sel: string): string | null {
  const s = decodeCssEscapes(sel).trim();
  if (!s || /[<>{}@;]/.test(s)) return null;
  return s;
}

/**
 * Пересборка стайлшита из безопасных правил. Возвращает CSS или null, если
 * безопасного не осталось. `@media`/`@supports` рекурсируются; любое другое
 * at-правило (в т.ч. `@import` — сетевой запрос) выбрасывается вместе с телом.
 */
function rebuild(css: string, depth: number): string {
  if (depth > 4) return "";
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = indexOfTopLevel(css, "{", i);
    if (open < 0) break;
    // Всё до последнего `;` в преамбуле — безблочные at-правила (@import/@charset): вон.
    const preludeRaw = css.slice(i, open);
    const lastSemi = preludeRaw.lastIndexOf(";");
    const prelude = (lastSemi >= 0 ? preludeRaw.slice(lastSemi + 1) : preludeRaw).trim();
    const close = matchingBrace(css, open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    i = close + 1;

    if (prelude.startsWith("@")) {
      const at = decodeCssEscapes(prelude).trim();
      if (/^@(media|supports)\b/i.test(at) && !/[<>{}]/.test(at)) {
        const inner = rebuild(body, depth + 1);
        if (inner) out.push(`${at}{${inner}}`);
      }
      continue; // прочие at-правила (@keyframes/@import/@font-face) — целиком вон
    }
    const sel = safeSelector(prelude);
    if (!sel) continue;
    const decls = splitDeclarations(body)
      .map(sanitizeDeclaration)
      .filter((d): d is string => d !== null);
    if (decls.length) out.push(`${sel}{${decls.join(";")}}`);
  }
  return out.join("\n");
}

/** Индекс символа `ch` вне строк, начиная с `from`. */
function indexOfTopLevel(s: string, ch: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === ch) return i;
  }
  return -1;
}

/** Индекс `}`, парного к `{` на позиции `open` (с учётом вложенности и строк). */
function matchingBrace(s: string, open: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Стайлшит источника → безопасный CSS для srcdoc, либо null («стилей нет /
 * безопасного не осталось» — вызывающий код тогда не собирает embed).
 * Комментарии срезаются ПЕРЕД разбором (их стрип мог синтезировать `</style>`);
 * выход в HTML закрыт тем, что `<`/`>` не переживают ни селектор, ни значение.
 */
export function sanitizeEmbedCss(raw: string): string | null {
  const withoutComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!withoutComments.trim()) return null;
  const rebuilt = rebuild(withoutComments, 0).trim();
  return rebuilt || null;
}

/**
 * Инлайновый `style` узла карты → безопасные декларации или null. Тот же фильтр,
 * что у стайлшита (позиции `top:86px` живут, кастом-строки/`url(`/`content` — нет).
 */
export function sanitizeInlineMapStyle(raw: string): string | null {
  const decls = splitDeclarations(raw.replace(/\/\*[\s\S]*?\*\//g, ""))
    .map(sanitizeDeclaration)
    .filter((d): d is string => d !== null);
  return decls.length ? decls.join(";") : null;
}
