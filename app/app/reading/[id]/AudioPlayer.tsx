"use client";

import { useRef, useState } from "react";
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

/**
 * AudioPlayer — плеер записи Listening. Модель реального IELTS single-pass:
 * запись играет один раз от начала до конца, БЕЗ перемотки (waveform не
 * кликабелен — нет seek). Поверх скрытого <audio>: круглая play/pause,
 * заполняющийся waveform, mono elapsed/total, бейдж «Plays once». Визуал 1:1 с
 * design-drop components/exam/AudioPlayer.
 */
export function AudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const progress = dur > 0 ? cur / dur : 0;
  const played = Math.round(Math.max(0, Math.min(1, progress)) * WAVE.length);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-3) var(--space-4)", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        style={{ display: "none" }}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause recording" : "Play recording"}
        style={{ width: 48, height: 48, flex: "none", borderRadius: "50%", border: "none", background: "var(--brand)", color: "var(--text-on-brand)", cursor: "pointer", display: "grid", placeItems: "center", boxShadow: "0 4px 0 0 var(--brand-edge)" }}
      >
        <Icon name={playing ? "pause" : "play"} size={20} strokeWidth={2.5} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" }}>Listening</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--warn-text)", background: "var(--warn-subtle)", borderRadius: "var(--radius-full)", padding: "2px 9px" }}>
            <Icon name="headphones" size={12} /> Plays once
          </span>
        </div>
        {/* Waveform — НЕ кликабелен (single pass, без перемотки). */}
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 2, height: 26 }}>
          {WAVE.map((h, i) => (
            <span
              key={i}
              style={{ flex: 1, height: `${h * 100}%`, borderRadius: 2, background: i < played ? "var(--brand)" : "var(--border-strong)", opacity: i < played ? 1 : 0.5, transition: "background-color 120ms linear, opacity 120ms linear" }}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: "none", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", color: "var(--text-secondary)", minWidth: 84, textAlign: "right" }}>
        {fmt(cur)} <span style={{ color: "var(--text-muted)" }}>/ {fmt(dur)}</span>
      </div>
    </div>
  );
}
