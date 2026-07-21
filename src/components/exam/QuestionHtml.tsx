"use client";

import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * QuestionHtml — verbatim-рендер оригинальной вёрстки вопросов (как реальный
 * computer-IELTS): инструкции группы, под-заголовки, списки, таблицы. Парсит
 * `questions_html` (DOMParser) и подставляет УПРАВЛЯЕМЫЕ React-инпуты на места
 * слотов `<span class="q-slot" data-q data-qtype data-value>`. Ответ пишется в те
 * же `onAnswer`/`onToggle` → `answers[number]`, поэтому грейдинг не меняется.
 *
 * Не парсится / SSR / пусто → рендерит `fallback` (атомизированный список),
 * поэтому фича безопасна: «непонятные» тесты просто рисуются как прежде.
 */
interface SlotCtx {
  answers: Record<string, string | string[]>;
  onAnswer: (n: number, v: string) => void;
  onToggle: (n: number, letter: string) => void;
}
const Ctx = createContext<SlotCtx | null>(null);

// HTML-атрибут → React-проп (для нестандартных имён).
const ATTR: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  colspan: "colSpan",
  rowspan: "rowSpan",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  nowrap: "noWrap",
};
const VOID = new Set(["br", "hr", "img", "col", "wbr"]);
// активный/интерактивный контент режем (на случай, если просочился мимо санитайза)
const SKIP = new Set([
  "script", "style", "button", "input", "form", "link", "meta", "iframe",
  "object", "embed", "noscript", "textarea", "select", "audio", "video",
]);

function Slot({ q, qtype, value }: { q: number; qtype: string; value?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const a = ctx.answers[String(q)];
  if (qtype === "radio") {
    const sel = a === value;
    return (
      <button type="button" role="radio" aria-checked={sel} aria-label={`Question ${q}, option ${value}`} onClick={() => ctx.onAnswer(q, value ?? "")} className="q-hit" style={S.radio(sel)}>
        {sel && <span style={S.dot} />}
      </button>
    );
  }
  if (qtype === "checkbox") {
    const arr = Array.isArray(a) ? a : a ? [a] : [];
    const sel = value != null && arr.includes(value);
    return (
      <button type="button" role="checkbox" aria-checked={sel} aria-label={`Question ${q}, option ${value}`} onClick={() => ctx.onToggle(q, value ?? "")} className="q-hit" style={S.check(sel)}>
        {sel && <span style={S.tick}>✓</span>}
      </button>
    );
  }
  // text (default)
  const v = typeof a === "string" ? a : "";
  return (
    <input value={v} onChange={(e) => ctx.onAnswer(q, e.target.value)} aria-label={`Answer for question ${q}`} autoComplete="off" data-q={q} className="q-text" style={S.text(!!v)} />
  );
}

/** Ascending + deduped список чисел. Порядок отрисовки practice-аффордансов
 *  verbatim-панели: слоты одного вопроса (radio-группа) дают дубли, разные вопросы
 *  внутри блока — произвольный DOM-порядок; приводим к «1,2,3…» по номеру. */
function orderUnique(nums: number[]): number[] {
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** Номера вопросов (data-q слотов) внутри top-level блока verbatim-панели —
 *  куда монтировать аффордансы после этого блока (под таблицей/группой, каждый со
 *  ссылкой на номер). */
function slotNumbersIn(el: Element): number[] {
  const nums: number[] = [];
  for (const s of Array.from(el.querySelectorAll(".q-slot"))) {
    const q = Number(s.getAttribute("data-q"));
    if (Number.isFinite(q)) nums.push(q);
  }
  return orderUnique(nums);
}

function convert(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === 3) return node.textContent; // text
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  if (el.classList && el.classList.contains("q-slot")) {
    const q = Number(el.getAttribute("data-q"));
    if (!Number.isFinite(q)) return null;
    return <Slot key={key} q={q} qtype={el.getAttribute("data-qtype") ?? "text"} value={el.getAttribute("data-value") ?? undefined} />;
  }
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return null;
  const props: Record<string, unknown> = { key };
  for (const at of Array.from(el.attributes)) {
    if (at.name === "style") continue;
    props[ATTR[at.name] ?? at.name] = at.value;
  }
  if (VOID.has(tag)) return createElement(tag, props);
  const children = Array.from(el.childNodes).map((c, i) => convert(c, `${key}.${i}`));
  return createElement(tag, props, children);
}

export function QuestionHtml({
  html,
  answers,
  onAnswer,
  onToggle,
  fallback,
  renderAffordances,
}: {
  html: string;
  answers: Record<string, string | string[]>;
  onAnswer: (n: number, v: string) => void;
  onToggle: (n: number, letter: string) => void;
  fallback: ReactNode;
  /** Practice: рендер учебных аффордансов ОДНОГО вопроса (Check/Reveal/подсказки).
   *  undefined в mock/non-practice → verbatim рисуется как прежде, без аффордансов.
   *  Живёт в ExamRunner (владелец practice-стейта) — вызывается на каждом рендере
   *  вне tree-мемо, поэтому вердикты/ответы всегда свежие. */
  renderAffordances?: (questionNumber: number) => ReactNode;
}) {
  // mounted-гейт: SSR и первый клиентский рендер = fallback (нет DOMParser на
  // сервере) → нет hydration-mismatch; после mount парсим и показываем verbatim.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Memo держит СТРУКТУРУ (verbatim-узлы + номера вопросов каждого top-level блока),
  // зависит только от [html, mounted] — тик таймера её не пересобирает. Аффордансы
  // НЕ внутри мемо (иначе вердикты/ответы застыли бы): монтируются в render ниже
  // через renderAffordances. Инпуты слотов остаются живыми через Ctx.
  const blocks = useMemo(() => {
    if (!mounted) return null;
    try {
      const doc = new DOMParser().parseFromString(`<body><div id="r">${html}</div></body>`, "text/html");
      const root = doc.getElementById("r");
      if (!root) return null;
      const out = Array.from(root.childNodes).map((c, i) => ({
        node: convert(c, String(i)),
        // Аффордансы вешаем ПОСЛЕ каждого top-level блока (группа/таблица), по номерам
        // слотов внутри него — не инлайном у слота: слот может быть ячейкой таблицы или
        // одним из radio-группы (вставка сломала бы вёрстку / задублировала бы аффорданс).
        numbers: c.nodeType === 1 ? slotNumbersIn(c as Element) : [],
      }));
      return out.length ? out : null;
    } catch {
      return null; // битый HTML → фоллбэк
    }
  }, [html, mounted]);

  // Мемо значения контекста: без него каждый ре-рендер (например тик таймера родителя
  // ExamRunner) создаёт новый объект → все Slot'ы ре-рендерятся, хотя ответы не менялись.
  const ctxValue = useMemo<SlotCtx>(
    () => ({ answers, onAnswer, onToggle }),
    [answers, onAnswer, onToggle],
  );

  if (!mounted || blocks == null) return <>{fallback}</>;
  return (
    <Ctx.Provider value={ctxValue}>
      <style>{Q_CSS}</style>
      <div className="q-verbatim">
        {blocks.map((b, i) => (
          <Fragment key={i}>
            {b.node}
            {renderAffordances && b.numbers.length > 0 && (
              <div className="qa-cluster">
                {b.numbers.map((n) => (
                  <Fragment key={n}>{renderAffordances(n)}</Fragment>
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const S = {
  text: (filled: boolean): CSSProperties => ({
    display: "inline-block", minWidth: 110, maxWidth: 220, height: 30, margin: "0 5px",
    padding: "0 9px", verticalAlign: "baseline", borderRadius: "var(--radius-sm)",
    border: `1px solid ${filled ? "var(--brand)" : "var(--border-strong)"}`,
    background: "var(--surface-raised)", color: "var(--text-primary)",
    fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, outline: "none",
  }),
  radio: (sel: boolean): CSSProperties => ({
    width: 20, height: 20, flex: "none", borderRadius: "50%", padding: 0, cursor: "pointer",
    border: `2px solid ${sel ? "var(--brand)" : "var(--border-strong)"}`,
    background: "var(--surface-raised)", display: "inline-flex", alignItems: "center", justifyContent: "center",
  }),
  dot: { width: 9, height: 9, borderRadius: "50%", background: "var(--brand)" } as CSSProperties,
  check: (sel: boolean): CSSProperties => ({
    width: 20, height: 20, flex: "none", borderRadius: 5, padding: 0, cursor: "pointer",
    border: `2px solid ${sel ? "var(--brand)" : "var(--border-strong)"}`,
    background: sel ? "var(--brand)" : "var(--surface-raised)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  }),
  tick: { color: "var(--text-on-brand)", fontSize: 13, lineHeight: 1 } as CSSProperties,
};

const Q_CSS = `
.q-verbatim{font-family:var(--font-ui);color:var(--text-primary);font-size:var(--text-base);line-height:1.6}
.q-verbatim .question{margin:0 0 26px}
.q-verbatim .question-rubric h3,.q-verbatim .q-range{font-size:var(--text-lg);font-weight:800;margin:0 0 6px;color:var(--text-primary)}
.q-verbatim .question-rubric p,.q-verbatim .q-instruction{margin:2px 0;color:var(--text-secondary);font-size:var(--text-sm)}
.q-verbatim h4,.q-verbatim .notes-title,.q-verbatim .summary-title,.q-verbatim .form-title{font-weight:800;margin:16px 0 8px;text-align:center}
.q-verbatim h5,.q-verbatim .sub-head{font-weight:700;margin:14px 0 6px}
.q-verbatim ul,.q-verbatim .notes-list,.q-verbatim .bullet{margin:6px 0;padding-left:20px}
.q-verbatim li,.q-verbatim .notes-item{margin:7px 0;line-height:1.7}
.q-verbatim p{margin:8px 0;line-height:1.7}
.q-verbatim table{border-collapse:collapse;width:100%;margin:12px 0}
.q-verbatim th,.q-verbatim td{border:1px solid var(--border);padding:8px 9px;text-align:center;font-size:var(--text-sm)}
.q-verbatim .statement-cell,.q-verbatim th.statement-th{text-align:left}
.q-verbatim .stmt-flex,.q-verbatim .tfng-statement-wrapper{display:flex;align-items:flex-start;gap:8px}
.q-verbatim .match-num,.q-verbatim .tfng-number,.q-verbatim .opt-letter{font-weight:700}
.q-verbatim .tfng-question{margin:0 0 14px;padding:0 0 14px;border-bottom:1px solid var(--border)}
.q-verbatim .tfng-options-stack,.q-verbatim .mcq label,.q-verbatim .tfng-radio-label{margin-top:6px}
.q-verbatim .tfng-options-stack{display:flex;flex-direction:column;gap:8px;padding-left:26px}
.q-verbatim label,.q-verbatim .tfng-radio-label{display:flex;align-items:center;gap:9px;cursor:pointer}
.q-verbatim .tfng-instruction-box{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;align-items:center;margin:10px 0;padding:12px 14px;background:var(--surface-hover);border:1px solid var(--border);border-radius:8px;font-size:var(--text-sm)}
.q-verbatim .mcq{margin:0 0 18px;padding:0 0 14px;border-bottom:1px solid var(--border)}
.q-verbatim .stem{display:flex;gap:8px;margin-bottom:10px;font-weight:600}
.q-verbatim .materials-box,.q-verbatim .form-box,.q-verbatim .summary-wrap{margin:10px 0;padding:14px 16px;background:var(--surface-hover);border:1px solid var(--border);border-radius:8px}
.q-verbatim .analysis{display:none}
/* Practice-аффордансы (Check/Reveal/подсказки) монтируются кластером ПОД каждым
   блоком вопросов. В verbatim нет карточки-номера как в атомизированном списке →
   каждый пункт несёт свой заголовок «Question N» и якорь id (deep-link/навигатор).
   Классы аффордансов (.exam-*) идут из READING_CSS шелла (общие для обоих путей);
   их 39px-отступ под номер здесь не нужен (номер уже в .qa-num) — зануляем. */
.q-verbatim .qa-cluster{display:flex;flex-direction:column;gap:10px;margin:6px 0 26px}
.q-verbatim .qa-item{padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-inset)}
.q-verbatim .qa-num{margin-bottom:4px;font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.q-verbatim .qa-item .exam-check,.q-verbatim .qa-item .exam-fmt-hint,.q-verbatim .qa-item .exam-strategy,.q-verbatim .qa-item .exam-wtl{padding-left:0}
.q-verbatim .qa-item .exam-strategy-list{padding-left:22px}
/* Широкие таблицы вопросов скроллятся сами вместо клиппинга всей панели —
   безусловно: одноколоночный (табовый) режим раннера живёт до 1024px
   (ExamRunner min-width:1024px), а этот фикс раньше был заперт в ≤430px и не
   покрывал 431-1023px (планшеты, телефоны landscape). На десктопе, где таблица
   и так не шире контейнера, overflow-x:auto ничего не меняет визуально. */
.q-verbatim table{display:block;overflow-x:auto}
.q-verbatim td[nowrap],.q-verbatim th[nowrap]{white-space:normal}
@media (max-width:430px){
  /* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
  .q-verbatim .q-text{min-width:80px!important;max-width:100%!important;font-size:16px!important}
}
/* Тап-таргеты ≥44px на touch — не только узкие телефоны (планшеты/landscape тоже). */
@media (pointer:coarse){
  .q-verbatim .q-text{min-height:44px!important}
  .q-verbatim .q-hit{position:relative}
  .q-verbatim .q-hit::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px}
}
`;
