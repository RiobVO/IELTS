"use client";

import { type CSSProperties, useState } from "react";
import { Icon } from "@/components/core/icons";

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface QuestionFilterProps {
  categories?: FilterOption[];
  questionTypes?: FilterOption[];
  selectedCategories?: string[];
  selectedTypes?: string[];
  onToggleCategory?: (value: string) => void;
  onToggleType?: (value: string) => void;
  onClear?: () => void;
  resultCount?: number;
  style?: CSSProperties;
}

function Tag({ label, count, selected, subtle, onClick }: { label: string; count?: number; selected: boolean; subtle?: boolean; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  const restBg = subtle ? "var(--surface-inset)" : "var(--surface)";
  const bg = selected ? "var(--brand-subtle)" : hover ? "var(--surface-hover)" : restBg;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-pressed={selected}
      className="qf-tag"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: subtle ? 30 : 34,
        padding: subtle ? "0 12px" : "0 14px",
        borderRadius: "var(--radius-full)",
        border: `1px solid ${selected ? "var(--brand-border)" : "var(--border)"}`,
        background: bg,
        color: selected ? "var(--brand)" : "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        fontSize: subtle ? "var(--text-xs)" : "var(--text-sm)",
        fontWeight: "var(--weight-bold)",
        cursor: "pointer",
        transition: "var(--transition-colors)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {count != null && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: selected ? "var(--brand)" : "var(--text-muted)", opacity: 0.85 }}>{count}</span>
      )}
    </button>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-muted)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", marginBottom: 10 }}>
      {children}
    </div>
  );
}

/**
 * QuestionFilter — мультиселект-фильтр по категории И типу вопроса. Карточка с
 * заголовком (счётчик активных + Clear), двумя группами Tag-чипов (категории и
 * типы, типы — subtle-вариант) и опциональным футером с числом результатов.
 */
export function QuestionFilter({
  categories = [],
  questionTypes = [],
  selectedCategories = [],
  selectedTypes = [],
  onToggleCategory,
  onToggleType,
  onClear,
  resultCount,
  style,
}: QuestionFilterProps) {
  const activeCount = selectedCategories.length + selectedTypes.length;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "var(--space-5)", boxShadow: "var(--shadow-sm)", ...style }}>
      {/* На touch расширяем вертикальную зону тапа чипа до 44px без визуального роста
          (density фильтра сохраняется); на mouse-устройствах правило не активно. */}
      <style>{".qf-tag::after{content:none}@media (pointer:coarse){.qf-tag::after{content:\"\";position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:44px}}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-4)" }}>
        <Icon name="filter" size={18} style={{ color: "var(--brand)" }} />
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--text-primary)" }}>Filter</span>
        {activeCount > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--text-on-brand)", background: "var(--brand)", borderRadius: "var(--radius-full)", padding: "2px 8px" }}>{activeCount}</span>
        )}
        {activeCount > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, cursor: "pointer" }}
          >
            <Icon name="x" size={13} /> Clear
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div>
          <GroupLabel>Category</GroupLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {categories.map((c) => (
              <Tag key={c.value} label={c.label} count={c.count} selected={selectedCategories.includes(c.value)} onClick={() => onToggleCategory?.(c.value)} />
            ))}
          </div>
        </div>
      )}

      {categories.length > 0 && questionTypes.length > 0 && (
        <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--space-4) 0" }} />
      )}

      {questionTypes.length > 0 && (
        <div>
          <GroupLabel>Question type</GroupLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {questionTypes.map((t) => (
              <Tag key={t.value} label={t.label} count={t.count} selected={selectedTypes.includes(t.value)} subtle onClick={() => onToggleType?.(t.value)} />
            ))}
          </div>
        </div>
      )}

      {resultCount != null && (
        <div style={{ marginTop: "var(--space-5)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", fontWeight: 700 }}>{resultCount}</span> {resultCount === 1 ? "test" : "tests"}
        </div>
      )}
    </div>
  );
}
