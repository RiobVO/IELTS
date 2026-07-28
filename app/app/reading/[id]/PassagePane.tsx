"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { categoryLabel } from "@/lib/labels";
import { Icon } from "@/components/core/icons";
import { addAnnotation, deleteAnnotation, updateAnnotationNote } from "./actions";

export interface AnnotationRow {
  id: string;
  passage_order: number;
  kind: "highlight" | "note" | string;
  start_offset: number;
  end_offset: number;
  quote: string;
  note: string | null;
}
interface Passage {
  title: string | null;
  body_html: string;
  order: number;
}

const FONT_MIN = 15;
const FONT_MAX = 24;
const FONT_KEY = "bando-reading-size";
const THEME_KEY = "bando-reading-theme";

/* --- offset anchoring within a passage container's plain text --- */
function textOffset(container: HTMLElement, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return offset + nodeOffset;
    offset += (n.textContent ?? "").length;
  }
  return offset;
}

/** Wrap [start,end) of the container's plain text in <mark> spans (one per text
 *  node it spans), tagged with the annotation id/kind. Skips text already inside
 *  a mark so overlapping highlights don't nest. */
function wrapOffsets(container: HTMLElement, start: number, end: number, id: string, kind: string) {
  if (end <= start) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  const targets: { node: Text; from: number; to: number }[] = [];
  while ((n = walker.nextNode())) {
    const len = (n.textContent ?? "").length;
    const ns = pos;
    const ne = pos + len;
    const s = Math.max(start, ns);
    const e = Math.min(end, ne);
    if (s < e && (n.parentElement?.tagName ?? "") !== "MARK") {
      targets.push({ node: n as Text, from: s - ns, to: e - ns });
    }
    pos = ne;
  }
  // wrap last→first so earlier node refs stay valid
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    const range = document.createRange();
    range.setStart(t.node, t.from);
    range.setEnd(t.node, t.to);
    const mark = document.createElement("mark");
    mark.dataset.aid = id;
    mark.dataset.kind = kind;
    try {
      range.surroundContents(mark);
    } catch {
      /* range not surroundable (rare) — skip this fragment */
    }
  }
}

function unwrap(container: HTMLElement, id: string) {
  container.querySelectorAll(`mark[data-aid="${id}"]`).forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  container.normalize();
}

// memo: пропсы (contentItemId/title/category/passages/initialAnnotations/className)
// не меняются на тик таймера в раннере → тяжёлый рендер body_html не повторяется 1/сек.
export const PassagePane = memo(function PassagePane({
  contentItemId,
  title,
  category,
  passages,
  initialAnnotations,
  className,
}: {
  contentItemId: string;
  title: string;
  category: string;
  passages: Passage[];
  initialAnnotations: AnnotationRow[];
  /** Раннер задаёт раскладку панели (display/flex) классом — адаптив за ним. */
  className?: string;
}) {
  /* eslint-disable-line — тело компонента ниже без изменений */
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const didInit = useRef(false);

  const [annotations, setAnnotations] = useState<AnnotationRow[]>(initialAnnotations);
  const [mode, setMode] = useState<"highlight" | "note">("highlight");
  const [fontPx, setFontPx] = useState(18);
  const [theme, setTheme] = useState<"paper" | "sepia">("paper");
  const [progress, setProgress] = useState(0);
  const [editor, setEditor] = useState<{ id: string; quote: string; note: string } | null>(null);

  // Load saved reading prefs (client-only — no SSR mismatch).
  useEffect(() => {
    const f = Number(localStorage.getItem(FONT_KEY));
    if (f >= FONT_MIN && f <= FONT_MAX) setFontPx(f);
    if (localStorage.getItem(THEME_KEY) === "sepia") setTheme("sepia");
  }, []);
  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(fontPx));
  }, [fontPx]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const passageEl = useCallback((order: number): HTMLElement | null => {
    return articleRef.current?.querySelector(`[data-order="${order}"]`) ?? null;
  }, []);

  // One-time DOM post-processing: restore saved annotations. Буквы абзацев и
  // drop-cap теперь рисуются ЧИСТЫМ CSS (counters + :has + ::first-letter) —
  // клиентский JS для них оказался ненадёжен в проде, CSS-путь работает всегда.
  useLayoutEffect(() => {
    if (didInit.current || !articleRef.current) return;
    didInit.current = true;
    for (const a of initialAnnotations) {
      const c = passageEl(a.passage_order);
      if (c) wrapOffsets(c, a.start_offset, a.end_offset, a.id, a.kind === "note" ? "note" : "highlight");
    }
  }, [initialAnnotations, passageEl]);

  // Reading progress bar (rAF-throttled scroll).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Create a highlight/note from the current text selection.
  const onMouseUp = useCallback(async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (!text.trim()) return;
    const anchor =
      range.commonAncestorContainer.nodeType === 1
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    const container = anchor?.closest<HTMLElement>("[data-order]") ?? null;
    if (!container || !articleRef.current?.contains(container)) return;
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;

    const start = textOffset(container, range.startContainer, range.startOffset);
    const end = textOffset(container, range.endContainer, range.endOffset);
    const order = Number(container.dataset.order);
    sel.removeAllRanges();
    if (!(end > start)) return;

    const kind = mode;
    const res = await addAnnotation({
      contentItemId,
      passageOrder: order,
      kind,
      start,
      end,
      quote: text,
      note: null,
    });
    if (!res) return;
    wrapOffsets(container, start, end, res.id, kind);
    const row: AnnotationRow = {
      id: res.id,
      passage_order: order,
      kind,
      start_offset: start,
      end_offset: end,
      quote: text,
      note: null,
    };
    setAnnotations((a) => [...a, row]);
    if (kind === "note") setEditor({ id: res.id, quote: text, note: "" });
  }, [contentItemId, mode]);

  // Click an existing mark → open its editor (view/edit note · delete).
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const mark = (e.target as HTMLElement).closest?.("mark[data-aid]") as HTMLElement | null;
      if (!mark) return;
      const id = mark.dataset.aid!;
      const a = annotations.find((x) => x.id === id);
      if (a) setEditor({ id, quote: a.quote, note: a.note ?? "" });
    },
    [annotations],
  );

  const saveNote = useCallback(async () => {
    if (!editor) return;
    const { id, note } = editor;
    const kind: "highlight" | "note" = note.trim() ? "note" : "highlight";
    setAnnotations((a) => a.map((x) => (x.id === id ? { ...x, note: note || null, kind } : x)));
    // restyle the marks to reflect note/highlight
    for (const c of articleRef.current?.querySelectorAll<HTMLElement>("[data-order]") ?? []) {
      c.querySelectorAll<HTMLElement>(`mark[data-aid="${id}"]`).forEach((m) => (m.dataset.kind = kind));
    }
    setEditor(null);
    await updateAnnotationNote(id, note);
  }, [editor]);

  const removeAnn = useCallback(async () => {
    if (!editor) return;
    const { id } = editor;
    const a = annotations.find((x) => x.id === id);
    if (a) {
      const c = passageEl(a.passage_order);
      if (c) unwrap(c, id);
    }
    setAnnotations((arr) => arr.filter((x) => x.id !== id));
    setEditor(null);
    await deleteAnnotation(id);
  }, [editor, annotations, passageEl]);

  const wordCount = useMemo(() => {
    const text = passages.map((p) => p.body_html).join(" ").replace(/<[^>]+>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return words;
  }, [passages]);
  const readMin = Math.max(1, Math.round(wordCount / 200));
  const highlightCount = annotations.length;

  const surface = theme === "sepia" ? "color-mix(in oklab, var(--gold-500) 13%, var(--paper-light))" : "var(--reading-surface)";

  return (
    <div className={className} style={{ ...S.pane, background: surface }}>
      <style>{PASSAGE_CSS}</style>

      {/* reading progress */}
      <div style={S.progressTop}>
        <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "var(--brand)", borderRadius: "0 3px 3px 0", transition: "width 80ms linear" }} />
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={S.masthead}>
          <div style={S.overline}>{categoryLabel(category)}</div>
          <h2 style={S.ptitle}>{title}</h2>
          <div style={S.pmeta}>
            <span style={S.chip}>
              <Icon name="book-open" size={14} /> ≈ {wordCount.toLocaleString("en-US")} words
            </span>
            <span style={S.chip}>
              <Icon name="clock" size={14} /> {readMin} min read
            </span>
            {highlightCount > 0 && (
              <span style={{ ...S.chip, color: "var(--brand)" }}>
                <Icon name="highlighter" size={14} /> {highlightCount} {highlightCount === 1 ? "note" : "notes"}
              </span>
            )}
          </div>
          <div style={S.prule} />
        </div>

        <article
          ref={articleRef}
          className="bando-reading editorial"
          style={{ padding: "24px 48px 80px", maxWidth: 900, margin: "0 auto", fontSize: fontPx }}
          onMouseUp={onMouseUp}
          onClick={onClick}
        >
          {passages.map((p) => (
            <div key={p.order} data-order={p.order} dangerouslySetInnerHTML={{ __html: p.body_html }} />
          ))}
        </article>
      </div>

      {/* tool capsule */}
      <div style={S.capsule}>
        <button className="cap-btn" onClick={() => setMode("highlight")} aria-pressed={mode === "highlight"} title="Highlight" style={S.capBtn(mode === "highlight")}>
          <Icon name="highlighter" size={18} strokeWidth={2.1} />
        </button>
        <button className="cap-btn" onClick={() => setMode("note")} aria-pressed={mode === "note"} title="Note" style={S.capBtn(mode === "note")}>
          <Icon name="pen-line" size={18} strokeWidth={2.1} />
        </button>
        <span style={S.sep} />
        <button className="cap-btn" onClick={() => setFontPx((f) => Math.max(FONT_MIN, f - 1))} title="Smaller text" style={{ ...S.capBtn(false), fontSize: 13 }}>
          A−
        </button>
        <button className="cap-btn" onClick={() => setFontPx((f) => Math.min(FONT_MAX, f + 1))} title="Larger text" style={{ ...S.capBtn(false), fontSize: 17 }}>
          A+
        </button>
        <span style={S.sep} />
        <button className="cap-btn" onClick={() => setTheme((t) => (t === "paper" ? "sepia" : "paper"))} aria-pressed={theme === "sepia"} title="Toggle paper / sepia" style={S.capBtn(theme === "sepia")}>
          <Icon name="sun" size={18} strokeWidth={2.1} />
        </button>
      </div>

      {/* note editor / delete panel */}
      {editor && (
        <div style={S.editorWrap}>
          <div style={S.editor}>
            <div style={S.editorQuote}>“{editor.quote}”</div>
            <textarea
              value={editor.note}
              onChange={(e) => setEditor((ed) => (ed ? { ...ed, note: e.target.value } : ed))}
              placeholder="Add a note…"
              rows={3}
              style={S.editorTextarea}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <button onClick={removeAnn} title="Delete" style={S.editorDelete}>
                <Icon name="trash" size={15} strokeWidth={2.2} /> Delete
              </button>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={() => setEditor(null)} style={S.editorGhost}>
                  Close
                </button>
                <button onClick={saveNote} style={S.editorSave}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const PASSAGE_CSS = `
.bando-reading.editorial{font-family:var(--font-reading);color:var(--reading-text);line-height:1.75}
.bando-reading.editorial p{margin:0 0 1.15em;position:relative}
.bando-reading.editorial em{font-style:italic}
/* Буквы абзацев — ЕДИНЫЙ контракт после read-time нормализации
   (normalize-passage.ts): каждый абзац-блок = <p class="rp" data-letter="X">,
   первый помечен [data-first] для drop-cap. Один CSS-путь, без угадывания
   структуры. Лейн — padding-left; кружок на left:0 (p уже position:relative). */
.bando-reading.editorial p.rp{padding-left:46px}
.bando-reading.editorial p.rp::before{
  content:attr(data-letter);position:absolute;left:0;top:.12em;width:28px;height:28px;
  border:1px solid var(--reading-rule);border-radius:50%;display:grid;place-items:center;
  font-family:var(--font-ui);font-size:12.5px;font-weight:600;color:var(--reading-muted);line-height:1;
  background:#fff;
}
.bando-reading.editorial p.rp[data-first]::first-letter{
  float:left;font-family:var(--font-reading);font-size:3.4em;line-height:.82;font-weight:600;
  padding:.06em .12em 0 0;color:var(--brand);
}
.bando-reading.editorial mark{background:var(--reading-mark);border-radius:3px;padding:0 .08em;cursor:pointer}
.bando-reading.editorial mark[data-kind="note"]{
  background:var(--reading-note);border-bottom:2px solid color-mix(in oklab,var(--brand) 60%,transparent);
}
@media (prefers-reduced-motion:reduce){.bando-reading.editorial *{transition:none!important}}
/* Touch target: кнопки капсулы 38px → ≥44px на грубом указателе (десктоп без изменений). */
.cap-btn{width:38px;height:38px}
@media (pointer:coarse){.cap-btn{width:44px;height:44px}}
`;

const S = {
  pane: { minWidth: 0, flexDirection: "column", borderRight: "1px solid var(--border)", position: "relative" } as React.CSSProperties,
  progressTop: { height: 3, background: "color-mix(in oklab, var(--reading-rule) 70%, transparent)", flex: "none" } as React.CSSProperties,
  masthead: { padding: "30px 48px 0", maxWidth: 900, margin: "0 auto", textAlign: "center" } as React.CSSProperties,
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", fontWeight: 700 } as React.CSSProperties,
  ptitle: { fontFamily: "var(--font-reading)", fontWeight: 700, fontSize: 30, color: "var(--reading-text)", lineHeight: 1.18, letterSpacing: "-0.01em", margin: "10px 0 0" } as React.CSSProperties,
  // Чипсы (words / min read / notes) скрыты под Cambridge-видом — референс их не показывает.
  pmeta: { display: "none" } as React.CSSProperties,
  chip: { display: "inline-flex", alignItems: "center", gap: 6 } as React.CSSProperties,
  prule: { height: 1, background: "var(--reading-rule)", margin: "20px 0 0" } as React.CSSProperties,

  capsule: { position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 22, display: "flex", alignItems: "center", gap: 4, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: 6, boxShadow: "var(--shadow-lg)" } as React.CSSProperties,
  capBtn: (active: boolean): React.CSSProperties => ({
    borderRadius: "var(--radius-full)",
    border: "none",
    background: active ? "var(--brand)" : "transparent",
    color: active ? "var(--text-on-brand)" : "var(--text-secondary)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontWeight: 700,
  }),
  sep: { width: 1, height: 22, background: "var(--border)", margin: "0 3px" } as React.CSSProperties,

  editorWrap: { position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 74, width: "min(440px, 90%)", zIndex: 5 } as React.CSSProperties,
  editor: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 16 } as React.CSSProperties,
  editorQuote: { fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-md)", padding: "8px 10px", lineHeight: 1.45, maxHeight: 76, overflow: "auto" } as React.CSSProperties,
  editorTextarea: { width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", outline: "none", resize: "vertical" } as React.CSSProperties,
  editorDelete: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--error-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "6px 8px", borderRadius: "var(--radius-sm)" } as React.CSSProperties,
  editorGhost: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "8px 14px", borderRadius: "var(--radius-md)" } as React.CSSProperties,
  editorSave: { border: "none", background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "8px 16px", borderRadius: "var(--radius-md)", boxShadow: "0 3px 0 0 var(--brand-edge)" } as React.CSSProperties,
};
