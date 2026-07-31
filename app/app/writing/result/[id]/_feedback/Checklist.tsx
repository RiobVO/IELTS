"use client";

import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/core/icons";

/** Before-your-next-attempt checklist. Local UI toggle state only (not persisted). */
export function Checklist({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section>
      <h2 style={S.h2}>Before your next attempt</h2>
      <div style={S.card}>
        {items.map((item, i) => {
          const on = checked.has(i);
          return (
            <button key={i} type="button" onClick={() => toggle(i)} aria-pressed={on} style={S.item} className="wf-check">
              <span style={{ ...S.box, ...(on ? S.boxOn : null) }}>
                {on && <Icon name="check" size={14} strokeWidth={3} style={{ color: "white" }} />}
              </span>
              <span style={{ ...S.text, color: on ? "var(--text-muted)" : "var(--text-primary)", textDecoration: on ? "line-through" : "none" }}>
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const S: Record<string, CSSProperties> = {
  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "var(--text-primary)" },
  card: { display: "flex", flexDirection: "column", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 8 },
  item: { display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)" },
  box: { flex: "none", width: 24, height: 24, borderRadius: 7, border: "2px solid var(--border-strong)", display: "grid", placeItems: "center", transition: "var(--transition-colors)" },
  boxOn: { background: "var(--brand)", borderColor: "var(--brand)" },
  text: { fontSize: 14.5, fontWeight: 500, lineHeight: 1.4 },
};
