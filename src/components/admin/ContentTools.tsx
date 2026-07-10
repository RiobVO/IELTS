"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SubmitButton, ConfirmButton } from "./AdminSubmit";

/**
 * ContentTools — клиентские инструменты над SSR-списком контента: фильтр (title+status),
 * клавиатура ("/" фокусит фильтр, Esc чистит) и bulk-выбор драфтов. Список остаётся
 * серверным: bulk-чекбоксы в строках ассоциируются с этой формой через form="admin-bulk"
 * (id-ссылка, а не вложенность), поэтому per-row server-actions не трогаются. bulkAction —
 * server-action проп. Нужно, потому что списки шли только createdAt desc и правились
 * построчным кликом с ре-скроллом после каждого действия.
 */
const CSS = `
.adm-search:focus-visible{outline:none;box-shadow:var(--ring);border-color:var(--focus-ring)}
@media (prefers-reduced-motion:reduce){.adm-bulk{transition:none}}
`;

export function ContentTools({
  children,
  statuses,
  bulkAction,
}: {
  children: ReactNode;
  statuses: string[];
  bulkAction: (formData: FormData) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [empty, setEmpty] = useState(false);
  const [selected, setSelected] = useState(0);

  const rows = () => listRef.current?.querySelectorAll<HTMLElement>("[data-admin-row]") ?? [];
  const checkboxOf = (el: HTMLElement) => el.querySelector<HTMLInputElement>("[data-admin-check]");

  function recount() {
    let n = 0;
    rows().forEach((el) => {
      if (!el.hidden && checkboxOf(el)?.checked) n++;
    });
    setSelected(n);
  }

  function applyFilter(nextQ: string, nextStatus: string) {
    const needle = nextQ.trim().toLowerCase();
    let shown = 0;
    rows().forEach((el) => {
      const match =
        (el.dataset.title ?? "").includes(needle) && (nextStatus === "all" || el.dataset.status === nextStatus);
      el.hidden = !match;
      // скрытую строку снимаем с выбора — bulk действует только на видимое.
      if (!match) {
        const cb = checkboxOf(el);
        if (cb) cb.checked = false;
      }
      if (match) shown++;
    });
    setEmpty(shown === 0);
    recount();
  }

  function selectAllVisible() {
    let touched = false;
    rows().forEach((el) => {
      if (!el.hidden) {
        const cb = checkboxOf(el);
        if (cb) {
          cb.checked = true;
          touched = true;
        }
      }
    });
    if (touched) recount();
  }

  function clearSel() {
    rows().forEach((el) => {
      const cb = checkboxOf(el);
      if (cb) cb.checked = false;
    });
    setSelected(0);
  }

  // "/" фокусит фильтр (как в Linear/GitHub); Esc в фильтре — чистит.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && t === searchRef.current) {
        setQ("");
        applyFilter("", status);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <>
      <style>{CSS}</style>
      <div style={S.bar}>
        <input
          ref={searchRef}
          className="adm-search"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            applyFilter(e.target.value, status);
          }}
          placeholder="Filter by title  ( / )"
          aria-label="Filter content by title"
          style={S.input}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            applyFilter(q, e.target.value);
          }}
          aria-label="Filter by status"
          style={S.select}
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" onClick={selectAllVisible} style={S.selectAll}>
          Select all
        </button>
      </div>

      {/* onChange всплывает от bulk-чекбоксов строк → пересчёт выбранных */}
      <div ref={listRef} onChange={recount}>
        {children}
      </div>
      {empty && <p style={S.none}>No content matches this filter.</p>}

      {/* visibility:hidden (не только transform) убирает кнопки из tab-order и AT,
          когда ничего не выбрано — иначе фокус проваливался бы в off-screen форму
          (WCAG 4.1.2 aria-hidden-focus). */}
      <form
        id="admin-bulk"
        action={bulkAction}
        className="adm-bulk"
        style={{
          ...S.bulk,
          transform: selected ? "translate(-50%,0)" : "translate(-50%,180%)",
          visibility: selected ? "visible" : "hidden",
        }}
      >
        <span style={S.bulkCount}>{selected} selected</span>
        <ConfirmButton
          name="intent"
          value="approve"
          size="sm"
          variant="secondary"
          message={`Approve ${selected} test(s) without opening each key? Do this only after eyeballing their summaries.`}
        >
          Approve
        </ConfirmButton>
        <ConfirmButton
          name="intent"
          value="publish"
          size="sm"
          variant="success"
          icon="check"
          message={`Publish ${selected} selected test(s) live to students? Only approved ones go live.`}
        >
          Publish
        </ConfirmButton>
        <button type="button" onClick={clearSel} style={S.clear}>
          Clear
        </button>
      </form>
    </>
  );
}

const S: Record<string, CSSProperties> = {
  bar: { display: "flex", gap: 10, alignItems: "center", margin: "0 0 12px", flexWrap: "wrap" },
  input: {
    flex: "1 1 200px",
    minWidth: 0,
    height: 40,
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "0 12px",
    outline: "none",
  },
  select: {
    height: 40,
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "0 10px",
    cursor: "pointer",
  },
  selectAll: {
    height: 40,
    padding: "0 12px",
    background: "var(--surface)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  },
  none: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "12px 0 0" },
  bulk: {
    position: "fixed",
    left: "50%",
    bottom: "calc(20px + env(safe-area-inset-bottom))",
    // z 40 — выше sticky-нава (30), ниже tooltip (90); совпадает с UndoToast.
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px 10px 18px",
    background: "var(--surface-inverse)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    transition: "transform var(--duration-base) var(--ease-out)",
  },
  bulkCount: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--surface-inverse-ink)" },
  clear: {
    background: "transparent",
    border: "none",
    color: "var(--surface-inverse-ink)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    cursor: "pointer",
    opacity: 0.75,
    padding: "0 6px",
  },
};
