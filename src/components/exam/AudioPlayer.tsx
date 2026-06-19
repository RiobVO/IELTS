"use client";

import { useMemo, type CSSProperties } from "react";
import { Icon } from "@/components/core/icons";

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Детерминированная псевдо-waveform (стабильна между рендерами).
const WAVE = Array.from({ length: 56 }, (_, i) => {
  const a = Math.sin(i * 0.7) * 0.5 + Math.sin(i * 0.27) * 0.3 + 0.6;
  return 0.25 + Math.abs(a) * 0.6;
});

// Waveform: бары статичны (высоты из WAVE), цвет берут от класса ряда; заполнение
// гонит ОДИН clip-path на fill-ряде поверх base-ряда — без ре-рендера 56 баров за тик.
const WAVE_CSS = `
.ap-wave{position:relative;height:26px}
.ap-wave-row{position:absolute;inset:0;display:flex;align-items:center;gap:2px}
.ap-bar{flex:1;border-radius:2px}
.ap-wave-base .ap-bar{background:var(--border-strong);opacity:.5}
.ap-wave-fill{clip-path:inset(0 100% 0 0);transition:clip-path 120ms linear}
.ap-wave-fill .ap-bar{background:var(--brand)}
@media (prefers-reduced-motion:reduce){.ap-wave-fill{transition:none}}
`;

interface AudioPlayerProps {
  progress?: number; // 0..1
  playing?: boolean;
  totalSeconds?: number;
  /** Если заданы — показывает «Part {part} of {totalParts}»; иначе — «Listening». */
  part?: number;
  totalParts?: number;
  onTogglePlay?: () => void;
  style?: CSSProperties;
}

/**
 * AudioPlayer — плеер записи Listening. Модель реального IELTS single-pass:
 * запись играет один раз, БЕЗ перемотки (waveform не кликабелен — нет seek).
 * Контролируемый: родитель владеет часами (`progress`, `playing`, `onTogglePlay`).
 * waveform заполняется по progress, время mono tabular, бейдж «Plays once».
 */
export function AudioPlayer({
  progress = 0,
  playing = false,
  totalSeconds = 0,
  part,
  totalParts,
  onTogglePlay,
  style,
}: AudioPlayerProps) {
  const pct = Math.max(0, Math.min(1, progress));
  const elapsed = pct * totalSeconds;
  const played = Math.round(pct * WAVE.length);
  const playedPct = (played / WAVE.length) * 100;
  const hasParts = part != null && totalParts != null;

  // Статичные бары — мемоизируем, чтобы тики progress не ре-рендерили 56 спанов
  // (меняется только clip-path fill-ряда). Один и тот же набор для base и fill.
  const bars = useMemo(
    () => WAVE.map((h, i) => <span key={i} className="ap-bar" style={{ height: `${h * 100}%` }} />),
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--surface)",
        border: "2px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-solid)",
        ...style,
      }}
    >
      <style>{WAVE_CSS}</style>
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause recording" : "Play recording"}
        style={{ width: 48, height: 48, flex: "none", borderRadius: "50%", border: "none", background: "var(--brand)", color: "var(--text-on-brand)", cursor: "pointer", display: "grid", placeItems: "center", boxShadow: "0 4px 0 0 var(--brand-edge)" }}
      >
        <Icon name={playing ? "pause" : "play"} size={20} strokeWidth={2.5} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
          {hasParts ? (
            <>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" }}>Part {part}</span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>of {totalParts}</span>
            </>
          ) : (
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" }}>Listening</span>
          )}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--warn-text)", background: "var(--warn-subtle)", borderRadius: "var(--radius-full)", padding: "2px 9px" }}>
            <Icon name="headphones" size={12} /> Plays once
          </span>
        </div>
        {/* Waveform — НЕ кликабелен (single pass, без перемотки). Base-ряд (несыгранное)
            + fill-ряд (brand); заполнение задаёт clip-path по playedPct. */}
        <div className="ap-wave" aria-hidden="true">
          <div className="ap-wave-row ap-wave-base">{bars}</div>
          <div className="ap-wave-row ap-wave-fill" style={{ clipPath: `inset(0 ${100 - playedPct}% 0 0)` }}>
            {bars}
          </div>
        </div>
      </div>

      <div style={{ flex: "none", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", color: "var(--text-secondary)", minWidth: 84, textAlign: "right" }}>
        {fmt(elapsed)} <span style={{ color: "var(--text-muted)" }}>/ {fmt(totalSeconds)}</span>
      </div>
    </div>
  );
}
