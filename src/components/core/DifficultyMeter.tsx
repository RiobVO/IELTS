import { type CSSProperties } from "react";

/**
 * Difficulty meter — segmented bars + label, the canonical ordinal "level/strength"
 * pattern (cf. a password-strength meter: weak → medium → strong). Shared by the Writing
 * and Speaking catalogs so the two labs render difficulty identically and can't drift.
 * `ink` fills the active segments (each lab passes its own theme accent); `dimmed` greys
 * the fill for locked cards. The text label always accompanies the bars, so the scale
 * reads as a level, never as a rating.
 */
export function DifficultyMeter({
  level,
  label,
  ink,
  dimmed = false,
}: {
  level: 1 | 2 | 3;
  label: string;
  ink: string;
  dimmed?: boolean;
}) {
  return (
    <span style={S.meter} role="img" aria-label={`Difficulty: ${label} (${level} of 3)`} title={`Difficulty: ${label}`}>
      <span style={S.label}>{label}</span>
      <span style={S.track} aria-hidden="true">
        {[1, 2, 3].map((seg) => (
          <span
            key={seg}
            style={{ ...S.seg, background: seg <= level ? (dimmed ? "var(--text-disabled)" : ink) : "var(--surface-inset)" }}
          />
        ))}
      </span>
    </span>
  );
}

const S: Record<string, CSSProperties> = {
  meter: { display: "inline-flex", alignItems: "center", gap: 8, flex: "none" },
  label: { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500, color: "var(--text-muted)" },
  track: { display: "inline-flex", gap: 4 },
  seg: { width: 14, height: 4, borderRadius: 99, flex: "none" },
};
