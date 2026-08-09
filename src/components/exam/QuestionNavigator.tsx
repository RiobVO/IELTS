"use client";

import { type CSSProperties, memo, useState } from "react";

const RING = "0 0 0 2px var(--surface), 0 0 0 4px var(--brand)";

export interface NavQuestion {
  number: number;
  answered: boolean;
  flagged: boolean;
}
export interface NavPart {
  label: string;
  items: NavQuestion[];
}

interface QuestionNavigatorProps {
  /** Вопросы, сгруппированные по Part (пассаж/секция) в порядке появления. */
  parts: NavPart[];
  current: number;
  answered: number;
  total: number;
  onJump?: (n: number) => void;
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
      className="nav-cell"
      onClick={() => onJump?.(q.number)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      aria-current={active ? "true" : undefined}
      aria-label={`Question ${q.number}${q.answered ? ", answered" : ""}${q.flagged ? ", flagged for review" : ""}`}
      style={{
        position: "relative",
        flex: "none",
        width: 32,
        height: 32,
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

/**
 * QuestionNavigator — нижняя полоса на всю ширину, как в реальном computer-IELTS:
 * вопросы 1–40 сгруппированы по Part (пассаж/секция), горизонтальный скролл при
 * нехватке ширины. Состояние ячейки: active > flagged > answered > unanswered;
 * клавиатурный фокус показывает брендовый RING, flagged несёт точку в углу.
 * Справа — счётчик отвеченных. Метки Part показываем только при >1 секции.
 */
// memo: раннер тикает таймер-стейт 1/сек (на Listening ~4/сек); при стабильных
// parts (useMemo)/onJump (useCallback) полоса навигатора не ре-рендерится на тик.
export const QuestionNavigator = memo(function QuestionNavigator({ parts, current, answered, total, onJump }: QuestionNavigatorProps) {
  const multi = parts.length > 1;
  return (
    <nav aria-label="Question navigator" style={S.bar}>
      <style>{NAV_CSS}</style>
      <div style={S.scroller}>
        {parts.map((p, i) => (
          <div key={i} style={S.group}>
            {i > 0 && <span aria-hidden="true" style={S.divider} />}
            {multi && <span className="nav-partlabel" style={S.partLabel}>{p.label}</span>}
            <div style={S.cells}>
              {p.items.map((q) => (
                <NavCell key={q.number} q={q} active={q.number === current} onJump={onJump} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span style={S.counter} aria-live="polite" aria-label={`${answered} of ${total} answered`}>
        <b style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{answered}</b>/{total}
      </span>
    </nav>
  );
});

// Тап-таргет: ячейки навигатора 32px → ≥44px на узком экране (горизонтальный скроллер уже есть).
// partLabel ("Part 1"/"Part 2") — смысловой лейбл, поднимаем до 12px на узком экране.
const NAV_CSS = `@media (max-width:430px){.nav-cell{width:44px!important;height:44px!important}.nav-partlabel{font-size:12px!important}}`;

const S: Record<string, CSSProperties> = {
  bar: {
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "9px 16px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-raised)",
  },
  // Горизонтальный скролл: 40 ячеек + метки умещаются на широком экране, иначе скроллятся.
  scroller: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, overflowX: "auto", paddingBottom: 2 },
  group: { display: "flex", alignItems: "center", gap: 9, flex: "none" },
  divider: { flex: "none", width: 1, height: 24, background: "var(--border)", marginRight: 2 },
  partLabel: {
    flex: "none",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-2xs)",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  cells: { display: "flex", alignItems: "center", gap: 5 },
  counter: { flex: "none", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" },
};
