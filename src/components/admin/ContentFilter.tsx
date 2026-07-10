"use client";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * ContentFilter — клиентский фильтр над server-рендеренным списком контента.
 * Список остаётся SSR (server-actions в строках не трогаем): фильтр просто
 * переключает `hidden` на `[data-admin-row]`-потомках по data-title / data-status.
 * Нужен, потому что списки шли только createdAt desc — после ~30 тестов поиск был
 * ручным скроллом. children — это готовый <ul> со строками.
 */
export function ContentFilter({ children, statuses }: { children: ReactNode; statuses: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [empty, setEmpty] = useState(false);

  function apply(nextQ: string, nextStatus: string) {
    const rows = ref.current?.querySelectorAll<HTMLElement>("[data-admin-row]");
    if (!rows) return;
    const needle = nextQ.trim().toLowerCase();
    let shown = 0;
    rows.forEach((el) => {
      const title = el.dataset.title ?? "";
      const st = el.dataset.status ?? "";
      const match = title.includes(needle) && (nextStatus === "all" || st === nextStatus);
      el.hidden = !match;
      if (match) shown++;
    });
    setEmpty(shown === 0);
  }

  return (
    <>
      <div style={S.bar}>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            apply(e.target.value, status);
          }}
          placeholder="Filter by title…"
          aria-label="Filter content by title"
          style={S.input}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            apply(q, e.target.value);
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
      </div>
      <div ref={ref}>{children}</div>
      {empty && <p style={S.none}>No content matches this filter.</p>}
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
  none: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "12px 0 0" },
};
