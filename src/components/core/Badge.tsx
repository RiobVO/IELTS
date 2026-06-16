import type * as React from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warn" | "error";

const TONES: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "var(--surface-hover)", fg: "var(--text-secondary)", bd: "transparent" },
  brand: { bg: "var(--brand-subtle)", fg: "var(--text-link)", bd: "var(--brand-border)" },
  success: { bg: "var(--success-subtle)", fg: "var(--success-text)", bd: "transparent" },
  warn: { bg: "var(--warn-subtle)", fg: "var(--warn-text)", bd: "transparent" },
  error: { bg: "var(--error-subtle)", fg: "var(--error-text)", bd: "transparent" },
};

interface BadgeProps {
  children: React.ReactNode;
  /** Тон → семантическая палитра. @default "neutral" */
  tone?: BadgeTone;
  /** Моноширинный шрифт (для счётчиков / band). */
  mono?: boolean;
  style?: React.CSSProperties;
}

/** Badge — небольшая пилюля статуса/метки. Чистый презентационный компонент. */
export function Badge({ children, tone = "neutral", mono = false, style }: BadgeProps) {
  const t = TONES[tone] ?? TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: "var(--radius-full)",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "var(--tracking-wide)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
