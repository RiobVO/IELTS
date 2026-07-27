"use client";

import {
  createContext,
  createElement,
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
      <button type="button" role="radio" aria-checked={sel} aria-label={`Question ${q}, option ${value}`} onClick={() => ctx.onAnswer(q, value ?? "")} style={S.radio(sel)}>
        {sel && <span style={S.dot} />}
      </button>
    );
  }
  if (qtype === "checkbox") {
    const arr = Array.isArray(a) ? a : a ? [a] : [];
    const sel = value != null && arr.includes(value);
    return (
      <button type="button" role="checkbox" aria-checked={sel} aria-label={`Question ${q}, option ${value}`} onClick={() => ctx.onToggle(q, value ?? "")} style={S.check(sel)}>
        {sel && <span style={S.tick}>✓</span>}
      </button>
    );
  }
  // text (default)
  const v = typeof a === "string" ? a : "";
  return (
    <input value={v} onChange={(e) => ctx.onAnswer(q, e.target.value)} aria-label={`Answer for question ${q}`} autoComplete="off" data-q={q} style={S.text(!!v)} />
  );
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
}: {
  html: string;
  answers: Record<string, string | string[]>;
  onAnswer: (n: number, v: string) => void;
  onToggle: (n: number, letter: string) => void;
  fallback: ReactNode;
}) {
  // mounted-гейт: SSR и первый клиентский рендер = fallback (нет DOMParser на
  // сервере) → нет hydration-mismatch; после mount парсим и показываем verbatim.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const tree = useMemo(() => {
    if (!mounted) return null;
    try {
      const doc = new DOMParser().parseFromString(`<body><div id="r">${html}</div></body>`, "text/html");
      const root = doc.getElementById("r");
      if (!root) return null;
      const nodes = Array.from(root.childNodes).map((c, i) => convert(c, String(i)));
      return nodes.length ? nodes : null;
    } catch {
      return null; // битый HTML → фоллбэк
    }
  }, [html, mounted]);

  if (!mounted || tree == null) return <>{fallback}</>;
  return (
    <Ctx.Provider value={{ answers, onAnswer, onToggle }}>
      <style>{Q_CSS}</style>
      <div className="q-verbatim">{tree}</div>
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
`;
