"use client";

import { type CSSProperties, useState } from "react";

const RING = "0 0 0 2px var(--surface), 0 0 0 4px var(--brand)";

interface NavQuestion {
  number: number;
  answered: boolean;
  flagged: boolean;
}

interface QuestionNavigatorProps {
  questions: NavQuestion[];
  current: number;
  onJump?: (n: number) => void;
  columns?: number;
  style?: CSSProperties;
}

// Resting visual per state. Precedence: active > flagged > answered > unanswered.
function cell(q: NavQuestion, active: boolean): { bg: string; fg: string; ring: string } {
  if (active) return { bg: "var(--brand)", fg: "var(--text-on-brand)", ring: "none" };
  if (q.flagged) return { bg: "var(--warn-subtle)", fg: "var(--warn-text)", ring: "inset 0 0 0 1px var(--warn)" };
  if (q.answered) return { bg: "var(--surface-hover)", fg: "var(--text-primary)", ring: "inset 0 0 0 1px var(--border-strong)" };
  return { bg: "transparent", fg: "var(--text-muted)", ring: "inset 0 0 0 1px var(--border)" };
}

function NavCell({ q, active, onJump }: { q: NavQuestion; active: boolean; onJump?: (n: number) => void }) {
  const [focus, setFocus] = useState(false);
  const c = cell(q, active);
  return (
    <button
      onClick={() => onJump?.(q.number)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      aria-current={active ? "true" : undefined}
      aria-label={`Question ${q.number}${q.answered ? ", answered" : ""}${q.flagged ? ", flagged for review" : ""}`}
      style={{
        position: "relative",
        aspectRatio: "1 / 1",
        minWidth: 34,
        border: "none",
        borderRadius: "var(--radius-sm)",
        background: c.bg,
        color: c.fg,
        boxShadow: focus ? RING : c.ring,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "var(--transition-colors)",
      }}
    >
      {q.number}
      {q.flagged && !active && (
        <span aria-hidden="true" style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "var(--warn)" }} />
      )}
    </button>
  );
}

function Swatch({ bg, ring, dot, label }: { bg: string; ring?: string; dot?: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
      <span style={{ position: "relative", width: 14, height: 14, borderRadius: 4, background: bg, boxShadow: ring }}>
        {dot && <span style={{ position: "absolute", top: 1, right: 1, width: 4, height: 4, borderRadius: "50%", background: "var(--warn)" }} />}
      </span>
      {label}
    </span>
  );
}

/**
 * QuestionNavigator — сетка ячеек-вопросов + легенда. Состояние ячейки:
 * active > flagged > answered > unanswered. Клавиатурный фокус показывает
 * брендовый RING вместо resting-кольца. flagged несёт точку в углу.
 */
export function QuestionNavigator({ questions, current, onJump, columns = 8, style }: QuestionNavigatorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", ...style }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 6 }}>
        {questions.map((q) => (
          <NavCell key={q.number} q={q} active={q.number === current} onJump={onJump} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
        <Swatch bg="var(--brand)" label="Current" />
        <Swatch bg="var(--surface-hover)" ring="inset 0 0 0 1px var(--border-strong)" label="Answered" />
        <Swatch bg="transparent" ring="inset 0 0 0 1px var(--border)" label="Unanswered" />
        <Swatch bg="var(--warn-subtle)" ring="inset 0 0 0 1px var(--warn)" dot label="Flagged" />
      </div>
    </div>
  );
}
