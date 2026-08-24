"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { categoryLabel } from "@/lib/labels";
import { Icon } from "@/components/core/icons";
import { extractContext, normalizeWord } from "@/lib/vocab/saved-words";
import { addAnnotation, deleteAnnotation, updateAnnotationNote } from "./actions";
import { saveWord } from "../../vocabulary/saved-words-actions";

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

/** Тела пассажей изолированы за memo. PassagePane ре-рендерится на СВОЁМ state
 *  (scroll-progress, режим капсулы, редактор заметки, список аннотаций), и каждый
 *  такой ре-рендер заставляет React заново установить эти dangerouslySetInnerHTML-
 *  контейнеры — стирая <mark>, которые мы вставляем вне React (обёртка выделения).
 *  `passages` — стабильный проп, поэтому memo отбивает все ре-рендеры → React не
 *  реконсилирует этот DOM → марки выживают. (Та же логика, что у memo(PassagePane),
 *  защищающего марки от тика таймера родителя.) */
const PassageBodies = memo(function PassageBodies({ passages }: { passages: Passage[] }) {
  return (
    <>
      {passages.map((p) => (
        <div key={p.order} data-order={p.order} dangerouslySetInnerHTML={{ __html: p.body_html }} />
      ))}
    </>
  );
});

// memo: пропсы (contentItemId/title/category/passages/initialAnnotations/className)
// не меняются на тик таймера в раннере → тяжёлый рендер body_html не повторяется 1/сек.
export const PassagePane = memo(function PassagePane({
  contentItemId,
  title,
  category,
  passages,
  initialAnnotations,
  className,
  reader,
  canSaveWords,
}: {
  contentItemId: string;
  title: string;
  category: string;
  passages: Passage[];
  initialAnnotations: AnnotationRow[];
  /** Раннер задаёт раскладку панели (display/flex) классом — адаптив за ним. */
  className?: string;
  /**
   * P4 — внешние префы комфорта чтения (practice-reading). Заданы → переопределяют
   * размер/интерлиньяж/тему пассажа и убирают типографские кнопки капсулы (управление
   * ушло в шапку). Не заданы (mock/listening) → капсула и поведение прежние.
   */
  reader?: { fontPx: number; lineHeight: number; theme: "paper" | "sepia" } | null;
  /**
   * P11 — жест «Save word» из пассажа. Стабильный boolean от раннера: true только в
   * practice-чтении, в mock — false (капсула сохранения не показывается). Стабилен →
   * memo(PassagePane) не ломается.
   */
  canSaveWords?: boolean;
}) {
  /* eslint-disable-line — тело компонента ниже без изменений */
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const didInit = useRef(false);
  // P2b-1 — активный пульс-локатор (узел + таймер снятия). Императивно, вне React-state.
  const pulseRef = useRef<{ node: HTMLElement; timer: number } | null>(null);

  const [annotations, setAnnotations] = useState<AnnotationRow[]>(initialAnnotations);
  const [mode, setMode] = useState<"highlight" | "note">("highlight");
  const [fontPx, setFontPx] = useState(18);
  const [theme, setTheme] = useState<"paper" | "sepia">("paper");
  const [progress, setProgress] = useState(0);
  const [editor, setEditor] = useState<{ id: string; quote: string; note: string } | null>(null);
  // P11 — плавающая капсула «Save word»: всплывает при выделении одиночного слова
  // (practice). Координаты — pane-relative (position:absolute внутри S.pane), считаются
  // из rect выделения. Рендерится СИБЛИНГОМ мемоизированного PassageBodies → пассаж не
  // реконсилируется, <mark> живут. savedFlash — success-состояние перед авто-снятием.
  const [saveBubble, setSaveBubble] = useState<{ word: string; context: string; x: number; y: number } | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  // Note-tool (выделение + заметки) — десктопная афорданс: на тач-вводе воюет с
  // нативными «ручками» выделения, а плавающая капсула перекрывает текст. На грубом
  // указателе прячем инструмент и не создаём аннотации (save-word ниже остаётся —
  // это отдельная vocab-фича). isTouch client-only → без SSR-mismatch. Существующие
  // марки (сделанные на десктопе) продолжают рендериться read-only.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia === "function") setIsTouch(window.matchMedia("(pointer:coarse)").matches);
  }, []);

  // Load saved reading prefs (client-only — no SSR mismatch). Storage может быть
  // недоступен (private mode/blocked) — try/catch, чтобы не ронять панель. При
  // внешнем reader (practice-панель «Aa», P4) legacy-ключи не читаем и не пишем:
  // источником префов служит reader, капсульные кнопки типографики скрыты.
  useEffect(() => {
    if (reader) return;
    try {
      const f = Number(localStorage.getItem(FONT_KEY));
      if (f >= FONT_MIN && f <= FONT_MAX) setFontPx(f);
      if (localStorage.getItem(THEME_KEY) === "sepia") setTheme("sepia");
    } catch {
      /* storage недоступен — остаются дефолты */
    }
  }, [reader]);
  useEffect(() => {
    if (reader) return;
    try {
      localStorage.setItem(FONT_KEY, String(fontPx));
    } catch {
      /* storage недоступен — преф не сохранится, не критично */
    }
  }, [fontPx, reader]);
  useEffect(() => {
    if (reader) return;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage недоступен — преф не сохранится, не критично */
    }
  }, [theme, reader]);

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
      // P11 — прокрутка уводит слово из-под капсулы (координаты pane-relative стали бы
      // неверны) → снимаем её сразу. No-op, если капсулы нет (React гасит тот же state).
      setSaveBubble(null);
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

  // P2b-1 — локатор абзаца по evidence.para (событие от раннера, exam:locate-para).
  // PassagePane владеет DOM-резолвом: (1) id-якорь абзаца (прод-формат "para-11") или
  // (2) одиночная буква → .rp[data-letter="X"]. Пульс-подсветка навешивается КЛАССОМ на
  // найденный узел ИМПЕРАТИВНО (без setState) — иначе ре-рендер стёр бы <mark>. Узел
  // живёт в мемоизированном PassageBodies (passages стабилен) → и узел, и класс переживают
  // ре-рендеры пассажа. Не резолвится (listening {part,text} без para и т.п.) → тихий выход.
  useEffect(() => {
    const onLocate = (e: Event) => {
      const article = articleRef.current;
      if (!article) return;
      const detail = (e as CustomEvent<{ para?: string }>).detail;
      const para = typeof detail?.para === "string" ? detail.para.trim() : "";
      if (!para) return;

      let node: HTMLElement | null = null;
      // Форма 1: id-якорь абзаца ("para-11"). CSS.escape + try/catch — para серверный,
      // но экранируем на случай спецсимволов в селекторе.
      try {
        node = article.querySelector<HTMLElement>(`#${CSS.escape(para)}`);
      } catch {
        node = null;
      }
      // Форма 2: одиночная буква абзаца (matching-разметка .rp[data-letter]).
      if (!node && /^[A-Za-z]$/.test(para)) {
        node = article.querySelector<HTMLElement>(`.rp[data-letter="${para.toUpperCase()}"]`);
      }
      if (!node) return; // якорь не найден — изящная деградация (кнопка тихо не реагирует)
      const target = node;

      const reduce =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion:reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });

      // Снять прежний пульс, навесить новый (~2с). CSS гасит анимацию при reduced-motion
      // (остаётся только скролл), поэтому класс навешиваем безусловно.
      const prev = pulseRef.current;
      if (prev) {
        prev.node.classList.remove("rp-locate");
        clearTimeout(prev.timer);
      }
      target.classList.add("rp-locate");
      const timer = window.setTimeout(() => {
        target.classList.remove("rp-locate");
        pulseRef.current = null;
      }, 2000);
      pulseRef.current = { node: target, timer };
    };
    window.addEventListener("exam:locate-para", onLocate);
    return () => {
      window.removeEventListener("exam:locate-para", onLocate);
      const p = pulseRef.current;
      if (p) {
        p.node.classList.remove("rp-locate");
        clearTimeout(p.timer);
        pulseRef.current = null;
      }
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

    // P11 — кандидат в «saved word»: одиночное короткое слово в practice-чтении.
    // Капсулу показываем ДОПОЛНИТЕЛЬНО к обычной подсветке (annotation для сохранения
    // НЕ создаём — highlight приходит от своего инструмента, как и раньше). rect берём
    // ДО removeAllRanges (после selection пуст). Координаты — pane-relative, чтобы не
    // зависеть от возможного transformed-предка (position:absolute внутри S.pane).
    const savedCandidate = canSaveWords ? normalizeWord(text) : null;
    if (savedCandidate) {
      const rect = range.getBoundingClientRect();
      const paneRect = paneRef.current?.getBoundingClientRect();
      const rawX = rect.left + rect.width / 2 - (paneRect?.left ?? 0);
      const x = paneRect ? Math.min(Math.max(rawX, 56), paneRect.width - 56) : rawX;
      const y = rect.top - (paneRect?.top ?? 0);
      setSavedFlash(false);
      setSaveBubble({ word: savedCandidate, context: extractContext(container.textContent ?? "", start, end), x, y });
    }

    sel.removeAllRanges();
    // На тач-вводе highlight/note выключены — save-word (выше) уже показан, аннотацию не создаём.
    if (isTouch || !(end > start)) return;

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
    if (!res) return; // best-effort: серверный insert не удался — не блокируем экзамен
    try {
      wrapOffsets(container, start, end, res.id, kind);
    } catch {
      // Обёртка марка упала (редкий не-surroundable range) — аннотация сохранена,
      // отрисуется при следующей загрузке. Не глушим editor/счётчик ниже.
    }
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
  }, [contentItemId, mode, canSaveWords, isTouch]);

  // Click an existing mark → open its editor (view/edit note · delete). На тач-вводе
  // редактор не открываем — note-tool десктопный; марки остаются read-only.
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (isTouch) return;
      const mark = (e.target as HTMLElement).closest?.("mark[data-aid]") as HTMLElement | null;
      if (!mark) return;
      const id = mark.dataset.aid!;
      const a = annotations.find((x) => x.id === id);
      if (a) setEditor({ id, quote: a.quote, note: a.note ?? "" });
    },
    [annotations, isTouch],
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

  // P11 — авто-снятие капсулы «Save word»: после успеха коротко держим «Saved», иначе
  // страховочный таймаут (если юзер не сохранил и не проскроллил).
  useEffect(() => {
    if (!saveBubble) return;
    const t = window.setTimeout(() => setSaveBubble(null), savedFlash ? 1600 : 6000);
    return () => clearTimeout(t);
  }, [saveBubble, savedFlash]);

  // P11 — сохранение слова owner-path (best-effort). Успех → «Saved to My words»
  // (эффект выше снимет капсулу); невалид/ошибка → тихо убираем. Аннотацию НЕ создаём.
  const doSaveWord = useCallback(async () => {
    if (!saveBubble || savedFlash) return;
    const res = await saveWord(saveBubble.word, saveBubble.context, contentItemId);
    if (res.ok) setSavedFlash(true);
    else setSaveBubble(null);
  }, [saveBubble, savedFlash, contentItemId]);

  const wordCount = useMemo(() => {
    const text = passages.map((p) => p.body_html).join(" ").replace(/<[^>]+>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return words;
  }, [passages]);
  const readMin = Math.max(1, Math.round(wordCount / 200));
  const highlightCount = annotations.length;

  // P4: внешние префы (practice) переопределяют внутренние font/theme; иначе — капсула.
  const effFont = reader ? reader.fontPx : fontPx;
  const effTheme = reader ? reader.theme : theme;
  const surface = effTheme === "sepia" ? "color-mix(in oklab, var(--gold-500) 13%, var(--paper-light))" : "var(--reading-surface)";

  return (
    <div ref={paneRef} className={className} style={{ ...S.pane, background: surface }}>
      <style>{PASSAGE_CSS}</style>

      {/* reading progress */}
      <div style={S.progressTop}>
        <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "var(--brand)", borderRadius: "0 3px 3px 0", transition: "width 80ms linear" }} />
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div className="pp-masthead" style={S.masthead}>
          <div style={S.overline}>{categoryLabel(category)}</div>
          <h2 className="pp-title" style={S.ptitle}>{title}</h2>
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
          className="bando-reading editorial pp-article"
          style={{ maxWidth: 900, margin: "0 auto", "--pp-font": `${effFont}px`, ...(reader ? { "--pp-lh": String(reader.lineHeight) } : null) } as React.CSSProperties}
          onMouseUp={onMouseUp}
          onClick={onClick}
        >
          <PassageBodies passages={passages} />
        </article>
      </div>

      {/* tool capsule — desktop-only floating toolbar (highlight/note create-tool +
          Aa/theme fallback для mock, у которого нет аналога в шапке). На тач
          (coarse pointer) капсула не рендерится ВООБЩЕ: будучи position:absolute
          внутри полноразмерного pane, она висела на месте, пока пассаж скроллился
          под ней, и наезжала на строки текста — тот же гейт, что уже применён к
          note-tool (mobile redesign, cb3dc4a), теперь на весь тулбар целиком, а не
          только на пару highlight/note. Существующие <mark> остаются read-only
          видимыми независимо от isTouch (см. useLayoutEffect выше).
          isTouch выставляется в useEffect → первый SSR/гидрационный кадр рендерит
          капсулу и на таче; CSS-гейт .pp-capsule (pointer:coarse) прячет её с
          ПЕРВОГО кадра, JS-гейт затем убирает из DOM (Codex 2026-07-11). */}
      {!isTouch && (
      <div className="pp-capsule" style={S.capsule}>
        <button className="cap-btn" onClick={() => setMode("highlight")} aria-pressed={mode === "highlight"} title="Highlight" style={S.capBtn(mode === "highlight")}>
          <Icon name="highlighter" size={18} strokeWidth={2.1} />
        </button>
        <button className="cap-btn" onClick={() => setMode("note")} aria-pressed={mode === "note"} title="Note" style={S.capBtn(mode === "note")}>
          <Icon name="pen-line" size={18} strokeWidth={2.1} />
        </button>
        {/* P4: типографские кнопки (размер/тема) капсулы прячем в practice — управление
            ушло в панель шапки. Без reader (mock/listening) капсула прежняя. */}
        {!reader && (
          <>
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
          </>
        )}
      </div>
      )}

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
              className="pp-note-textarea"
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

      {/* P11 — плавающая капсула «Save word» (practice-only, canSaveWords). Абсолютна
          внутри S.pane; success-состояние показывает «Saved to My words». */}
      {saveBubble && (
        <div className="pp-saveword" style={{ ...S.saveBubble, left: saveBubble.x, top: Math.max(8, saveBubble.y - 46) }}>
          {savedFlash ? (
            <span style={S.saveDone}>
              <Icon name="circle-check" size={16} strokeWidth={2.4} /> Saved to My words
            </span>
          ) : (
            <button type="button" className="pp-saveword-btn" onClick={doSaveWord} title={`Save “${saveBubble.word}” to My words`} style={S.saveBtn}>
              <Icon name="star" size={15} strokeWidth={2.2} /> Save word
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const PASSAGE_CSS = `
.bando-reading.editorial{font-family:var(--font-reading);color:var(--reading-text);line-height:var(--pp-lh,1.75);font-size:var(--pp-font,18px)}
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
/* Practice-verbatim: пассивная метка Matching-Headings (drop-зона нейтрализована,
   вопрос рендерится select'ом в панели). Небольшой приглушённый номер-чип, без
   интерактивного вида. */
.bando-reading.editorial .heading-drop.hd-passive{
  display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:26px;
  padding:0 8px;margin:0 0 6px;border:1px dashed var(--reading-rule);border-radius:var(--radius-full);
  font-family:var(--font-ui);font-size:12px;font-weight:700;color:var(--reading-muted);
  background:transparent;cursor:default;pointer-events:none;user-select:none;
}
.bando-reading.editorial .heading-drop.hd-passive .placeholder{color:inherit}
.bando-reading.editorial .heading-drop-line{margin:0 0 4px}
.bando-reading.editorial mark{background:var(--reading-mark);border-radius:3px;padding:0 .08em;cursor:pointer}
.bando-reading.editorial mark[data-kind="note"]{
  background:var(--reading-note);border-bottom:2px solid color-mix(in oklab,var(--brand) 60%,transparent);
}
/* P2b-1 — пульс-подсветка найденного абзаца (~2с, класс навешивается императивно).
   При prefers-reduced-motion анимации нет → остаётся только скролл (без вспышки). */
.bando-reading.editorial .rp-locate{border-radius:5px;animation:rp-locate-pulse 2s ease-out 1}
@keyframes rp-locate-pulse{
  0%{background:color-mix(in oklab,var(--brand) 24%,transparent)}
  70%{background:color-mix(in oklab,var(--brand) 16%,transparent)}
  100%{background:transparent}
}
@media (prefers-reduced-motion:reduce){.bando-reading.editorial *{transition:none!important}}
@media (prefers-reduced-motion:reduce){.bando-reading.editorial .rp-locate{animation:none}}
/* Touch target: кнопки капсулы 38px → ≥44px на грубом указателе (десктоп без изменений). */
.cap-btn{width:38px;height:38px}
@media (pointer:coarse){.cap-btn{width:44px;height:44px}}
@media (pointer:coarse){.pp-capsule{display:none}}
/* P11 — капсула «Save word»: лёгкий вход; тач ≥44px; reduced-motion гасит анимацию. */
.pp-saveword{animation:pp-saveword-in 140ms var(--ease-standard) 1}
@keyframes pp-saveword-in{from{opacity:0;transform:translateX(-50%) translateY(5px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.pp-saveword-btn:hover{filter:brightness(1.06)}
@media (pointer:coarse){.pp-saveword-btn{min-height:44px}}
@media (prefers-reduced-motion:reduce){.pp-saveword{animation:none}}
/* Адаптив пассажа (mobile-first). Single-tab колонка живёт 0–1023px (две панели
   только ≥1024px, см. ExamRunner .exam-split), поэтому широкие поля 48px нужны лишь
   на десктопе — на телефоне они съедали читаемую ширину. Поля/размеры — в классах
   (не inline), иначе media-query их не победит. */
.pp-article{padding:20px 20px 72px}
.pp-masthead{padding:24px 20px 0}
.pp-title{font-size:24px}
@media (min-width:641px){
  .pp-article{padding:24px 32px 80px}
  .pp-masthead{padding:28px 32px 0}
  .pp-title{font-size:27px}
}
@media (min-width:1024px){
  .pp-article{padding:24px 48px 80px}
  .pp-masthead{padding:30px 48px 0}
  .pp-title{font-size:30px}
}
/* Телефон: кегль пассажа на 2px меньше выбранного в Aa (пол 16px — «большие буквы»
   больше не выпирают на узкой колонке); поля к краям поджаты до 16px. */
@media (max-width:640px){
  .bando-reading.editorial{font-size:max(16px,calc(var(--pp-font,18px) - 2px))}
}
@media (max-width:430px){
  .pp-article{padding-left:16px;padding-right:16px}
  .pp-masthead{padding-left:16px;padding-right:16px}
  /* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
  .pp-note-textarea{font-size:16px!important}
}
`;

const S = {
  pane: { minWidth: 0, flexDirection: "column", borderRight: "1px solid var(--border)", position: "relative" } as React.CSSProperties,
  progressTop: { height: 3, background: "color-mix(in oklab, var(--reading-rule) 70%, transparent)", flex: "none" } as React.CSSProperties,
  masthead: { maxWidth: 900, margin: "0 auto", textAlign: "center" } as React.CSSProperties,
  overline: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", fontWeight: 700 } as React.CSSProperties,
  ptitle: { fontFamily: "var(--font-reading)", fontWeight: 700, color: "var(--reading-text)", lineHeight: 1.18, letterSpacing: "-0.01em", margin: "10px 0 0" } as React.CSSProperties,
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

  // P11 — капсула «Save word» (position:absolute внутри S.pane; transform центрирует по x).
  saveBubble: { position: "absolute", transform: "translateX(-50%)", zIndex: 6 } as React.CSSProperties,
  saveBtn: { display: "inline-flex", alignItems: "center", gap: 7, minHeight: 38, padding: "8px 14px", borderRadius: "var(--radius-full)", border: "none", background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, letterSpacing: "0.01em", cursor: "pointer", boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap", transition: "var(--transition-colors)" } as React.CSSProperties,
  saveDone: { display: "inline-flex", alignItems: "center", gap: 7, minHeight: 38, padding: "8px 14px", borderRadius: "var(--radius-full)", background: "var(--surface)", color: "var(--success-text)", border: "1px solid var(--border)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, letterSpacing: "0.01em", boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap" } as React.CSSProperties,

  editorWrap: { position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 74, width: "min(440px, 90%)", zIndex: 5 } as React.CSSProperties,
  editor: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 16 } as React.CSSProperties,
  editorQuote: { fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-md)", padding: "8px 10px", lineHeight: 1.45, maxHeight: 76, overflow: "auto" } as React.CSSProperties,
  editorTextarea: { width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", outline: "none", resize: "vertical" } as React.CSSProperties,
  editorDelete: { display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--error-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "6px 8px", borderRadius: "var(--radius-sm)" } as React.CSSProperties,
  editorGhost: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "8px 14px", borderRadius: "var(--radius-md)" } as React.CSSProperties,
  editorSave: { border: "none", background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "8px 16px", borderRadius: "var(--radius-md)", boxShadow: "0 3px 0 0 var(--brand-edge)" } as React.CSSProperties,
};
