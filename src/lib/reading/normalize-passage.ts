import { load } from "cheerio";

/**
 * Приводит разнородную разметку абзацев reading-пассажа к ЕДИНОМУ контракту, на
 * который опирается ровно один CSS-путь в PassagePane:
 *
 *   <p class="rp" data-letter="A" [data-first]>…текст…</p>
 *
 * Зачем: тесты импортированы в разное время разными ветками парсера, и метки
 * абзацев лежат в `body_html` минимум пятью способами (голый <p>, .para-label
 * внутри <p>, .para-letter в .para-block, …). Раньше это разгребалось в CSS
 * (`:has()`/counters/стилизация разных классов) — хрупко: новый формат ломал
 * вёрстку. Нормализация на read-time собирает всю грязь в одном тестируемом
 * месте; CSS получает один предсказуемый формат. Работает над существующими
 * данными — без ре-импорта (он заблокирован при наличии попыток).
 *
 * matching-разметку (`.heading-drop` / `.paragraph-block`) НЕ трогаем: там буквы
 * и числа — часть интерактивной механики вопросов, а не декор; только снимаем
 * дубль-заголовок.
 *
 * @param html  сырой body_html пассажа
 * @param title заголовок теста (masthead) — ведущий <h1>/<h2>, дублирующий его,
 *              убираем (single-passage); у full-reading <h2> = имя пассажа, остаётся
 */
export function normalizePassageHtml(html: string, title: string): string {
  const $ = load(html, null, false);

  // 1. Снять ведущий заголовок, если он дублирует masthead-title.
  const heading = $("h1, h2").first();
  if (heading.length && norm(heading.text()) === norm(title)) {
    heading.remove();
  }

  // 2. matching/интерактивная разметка — оставляем как есть (буквы/числа функциональны).
  if ($(".heading-drop, .paragraph-block").length > 0) {
    return $.html();
  }

  // 3. Унифицируем декоративные форматы в <p class="rp" data-letter="X">.
  let auto = 0;

  // 3a. .para-block: буква в .para-letter, текст в <p> внутри блока.
  $(".para-block").each((_, el) => {
    const block = $(el);
    const p = block.find("p").first();
    if (!p.length) return;
    const letter = block.find(".para-letter").first().text().trim() || alpha(auto);
    p.addClass("rp").attr("data-letter", letter).removeClass("subtitle");
    block.replaceWith(p);
    auto++;
  });

  // 3b. Остальные абзацы верхнего уровня.
  $("p").each((_, el) => {
    const p = $(el);
    if (p.hasClass("rp")) return; // уже из .para-block
    if (p.hasClass("subtitle")) return; // подзаголовок — не абзац-блок
    const label = p.find(".para-label").first();
    let letter: string;
    if (label.length) {
      letter = label.text().trim() || alpha(auto);
      label.remove();
      p.html((p.html() ?? "").replace(/^\s+/, "")); // снять ведущий пробел после метки
    } else {
      letter = alpha(auto);
    }
    p.addClass("rp").attr("data-letter", letter);
    auto++;
  });

  // 4. Пометить первый абзац-блок — для drop-cap (надёжнее, чем CSS :first-of-type,
  //    который спотыкается о подзаголовок-<p>).
  $("p.rp").first().attr("data-first", "");

  return $.html();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const alpha = (i: number) => String.fromCharCode(65 + (i % 26));
