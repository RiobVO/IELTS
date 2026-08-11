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
 *
 * КАНОНИЧНОСТЬ: декодирование escape'ов одним проходом не даёт канон-формы —
 * `\\75rl(…)` после прохода остаётся `\75rl(`, проверка не видит `url(`, а браузер
 * декодирует его уже после нашей пересборки (ревью 2026-08-11, четвёртый заход).
 * Поэтому декодированные имя/значение/селектор с ОСТАТОЧНЫМ обратным слешем
 * отвергаются целиком: в CSS-рисунке карты escape'ам взяться неоткуда, а правило
 * закрывает весь класс расхождений «санитайзер прочитал одно, браузер — другое».
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
 * декларацию при пересборке, `@`/`{`/`}` — подменили бы правило. Внутри кавычек они
 * безобидны (`font-family:"A;B"`) — для CSS-парсера.
 */
const VALUE_STRUCTURAL = /[;<>{}@]/;

/**
 * `<` запрещён ГДЕ УГОДНО, включая внутренность CSS-строк: HTML-парсер про кавычки
 * CSS не знает, и `font-family:"</style><p>…"` закрывает raw-text элемент `<style>` —
 * разметка после него проходит мимо гигиены фрагмента (ревью 2026-08-11, шестой
 * заход, HIGH). Ключевой символ здесь именно `<`: закрыть raw-text элемент без него
 * нельзя, поэтому `>` (дочерний комбинатор `.a > .b`) остаётся легитимным — сплошной
 * запрет обеих скобок молча выбрасывал такие правила (седьмой заход, п. 4).
 */
const LT_BRACKET = /</;

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
  let escaped = false;
  for (const ch of block) {
    // `\"` внутри строки НЕ закрывает её — иначе границы деклараций уезжают и
    // легитимные правила теряются при пересборке (ревью, четвёртый заход).
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escaped = true;
      continue;
    }
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
 * Строко-осведомлённый стрип комментариев: `content:"/*"` не должен «открывать»
 * комментарий и съедать следующее правило (ревью, четвёртый заход, MEDIUM).
 */
function stripComments(css: string): string {
  let out = "";
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) break; // незакрытый комментарий — хвост отбрасываем
      i = end + 1;
      continue;
    }
    out += ch;
  }
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
  // Остаточный слеш = вторая ступень escape'а, которую доклеит уже браузер (см. док).
  if (prop.includes("\\") || value.includes("\\")) return null;
  // В значении декларации `>` не несёт смысла — держим обе скобки под запретом;
  // послабление до `<` касается только селекторов (комбинатор) и преамбул (range).
  if (LT_BRACKET.test(prop) || LT_BRACKET.test(value) || /[<>]/.test(value)) return null;
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
 * Декларации, ПРЯЧУЩИЕ содержимое: типовые способы сделать вставленные символы
 * невидимыми, из-за которых порционная обфускация (`<span>Correct an</span>` +
 * скрытый узел + `<span>swer</span>`) рисовала бы чистый ключ, оставаясь невидимой
 * для конкатенации текста (ревью 2026-08-11, третий заход). Карта — это подписи
 * зданий и улиц, прятать их незачем, поэтому цена запрета низкая.
 *
 * ЧЕСТНАЯ ГРАНИЦА (ревью, четвёртый заход): это НЕ доказательство равенства
 * «текст сканера == видимый текст». Разрешённая геометрия оставляет другие способы
 * скрыть символ — нулевые размеры с overflow, `transform:scale(0)`, вынос за
 * пределы вьюпорта, перекрытие соседом, прозрачная SVG-заливка. Список закрывает
 * распространённые механизмы, а не класс целиком.
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
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (VALUE_STRUCTURAL.test(ch)) return false;
  }
  return quote === null && !escaped;
}

/**
 * То же для селектора, но `>` пропускается: это дочерний комбинатор, а не выход из
 * разметки (закрыть `<style>` без `<` нельзя — им и занимается LT_BRACKET).
 */
function structurallySafeSelector(sel: string): boolean {
  let quote: string | null = null;
  let escaped = false;
  for (const ch of sel) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch !== ">" && VALUE_STRUCTURAL.test(ch)) return false;
  }
  return quote === null && !escaped;
}

/**
 * Преамбула группирующего at-правила (`@media (max-width:700px)`) уходит в вывод
 * ЦЕЛИКОМ, поэтому обязана пройти тот же канон-контроль, что селекторы и значения:
 * раньше её проверяли лишь на `<>{}`, и остаточный escape мог стать структурным
 * разделителем уже в браузере (ревью 2026-08-11, пятый заход, HIGH). Сверх канона —
 * узкая грамматика условия: буквы/цифры/пробелы/скобки и пунктуация медиа-фич.
 */
function safeAtPrelude(prelude: string): string | null {
  const at = decodeCssEscapes(prelude).trim();
  if (!/^@(media|supports)\b/i.test(at)) return null;
  if (at.includes("\\") || VALUE_FORBIDDEN.test(at)) return null;
  // Ведущий `@` легитимен — структурную проверку ведём по остатку.
  if (!structurallySafeSelector(at.slice(1))) return null;
  if (!/^@(media|supports)[a-z0-9\s():,./%_>=-]*$/i.test(at)) return null;
  return at;
}

/**
 * Селектор безопасен, если после декодирования не несёт разметку/at-правила.
 * `;`/`{`/`}`/`@` проверяются только ВНЕ строк (`[title="x;y"]` легитимен, ревью,
 * четвёртый заход), `<` — везде (см. LT_BRACKET), а `>` разрешён как дочерний
 * комбинатор (седьмой заход: сплошной запрет тихо выбрасывал `.a > .b`).
 */
function safeSelector(sel: string): string | null {
  const s = decodeCssEscapes(sel).trim();
  if (!s || s.includes("\\") || LT_BRACKET.test(s)) return null;
  if (!structurallySafeSelector(s)) return null;
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
    const lastSemi = lastTopLevelSemicolon(preludeRaw);
    const prelude = (lastSemi >= 0 ? preludeRaw.slice(lastSemi + 1) : preludeRaw).trim();
    const close = matchingBrace(css, open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    i = close + 1;

    if (prelude.startsWith("@")) {
      const at = safeAtPrelude(prelude);
      if (at) {
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

/** Индекс символа `ch` вне строк, начиная с `from` (escape'ы учитываются). */
function indexOfTopLevel(s: string, ch: string, from: number): number {
  let quote: string | null = null;
  let escaped = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === ch) return i;
  }
  return -1;
}

/** Индекс `}`, парного к `{` на позиции `open` (вложенность, строки, escape'ы). */
function matchingBrace(s: string, open: number): number {
  let quote: string | null = null;
  let depth = 0;
  let escaped = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
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

/** Индекс последней `;` вне строк (граница безблочных at-правил в преамбуле). */
function lastTopLevelSemicolon(s: string): number {
  let last = -1;
  for (let i = indexOfTopLevel(s, ";", 0); i >= 0; i = indexOfTopLevel(s, ";", i + 1)) last = i;
  return last;
}

/**
 * Стайлшит источника → безопасный CSS для srcdoc, либо null («стилей нет /
 * безопасного не осталось» — вызывающий код тогда не собирает embed).
 * Комментарии срезаются ПЕРЕД разбором (их стрип мог синтезировать `</style>`);
 * выход в HTML закрыт тем, что `<`/`>` не переживают ни селектор, ни значение.
 */
export function sanitizeEmbedCss(raw: string): string | null {
  const withoutComments = stripComments(raw);
  if (!withoutComments.trim()) return null;
  const rebuilt = rebuild(withoutComments, 0).trim();
  if (!rebuilt) return null;
  // Пояс поверх лямок: ни один путь пересборки не имеет права вынести в srcdoc
  // угловую скобку — что бы мы ни упустили выше, из `<style>` это не вырвется.
  return LT_BRACKET.test(rebuilt) ? null : rebuilt;
}

/**
 * Инлайновый `style` узла карты → безопасные декларации или null. Тот же фильтр,
 * что у стайлшита (позиции `top:86px` живут, кастом-строки/`url(`/`content` — нет).
 */
export function sanitizeInlineMapStyle(raw: string): string | null {
  const decls = splitDeclarations(stripComments(raw))
    .map(sanitizeDeclaration)
    .filter((d): d is string => d !== null);
  if (!decls.length) return null;
  // Инлайн-стиль уезжает в атрибут того же документа — тот же пояс.
  const joined = decls.join(";");
  return LT_BRACKET.test(joined) ? null : joined;
}
