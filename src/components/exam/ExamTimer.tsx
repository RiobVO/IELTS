"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/core/icons";

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

interface ExamTimerProps {
  remainingSeconds: number;
  totalSeconds: number;
  paused?: boolean;
  onTogglePause?: () => void;
  compact?: boolean;
  style?: CSSProperties;
}

/**
 * ExamTimer — серверно-авторитетный обратный отсчёт. Спокойный по умолчанию;
 * warn при ≤5 мин, critical (с мягким миганием + glow) при ≤1 мин. Цифры mono,
 * tabular-nums. Тонкий 2px рейл снизу показывает израсходованное время.
 */
export function ExamTimer({
  remainingSeconds,
  totalSeconds,
  paused = false,
  onTogglePause,
  compact = false,
  style,
}: ExamTimerProps) {
  const ratio = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 0;
  const critical = remainingSeconds <= 60;
  const warning = !critical && remainingSeconds <= 300;
  const tone = critical ? "var(--error)" : warning ? "var(--warn)" : "var(--text-primary)";
  const rail = critical ? "var(--error)" : warning ? "var(--warn)" : "var(--brand)";
  const border = critical ? "var(--error)" : warning ? "var(--warn)" : "var(--border)";

  return (
    <div
      role="timer"
      aria-label="Time remaining"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: compact ? "7px 12px" : "9px 14px",
        background: "var(--surface-raised)",
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        boxShadow: critical ? "var(--glow-brand)" : "var(--shadow-xs)",
        ...style,
      }}
    >
      <Icon name={paused ? "pause" : "clock"} size={compact ? 16 : 18} style={{ color: tone }} />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: compact ? "var(--text-base)" : "var(--text-lg)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: tone,
          animation: critical ? "nine-blink 1s var(--ease-in-out) infinite" : "none",
        }}
      >
        {fmt(remainingSeconds)}
      </span>
      {onTogglePause && (
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? "Resume" : "Pause"}
          className="exam-timer-pause"
          style={{ display: "inline-flex", border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
        >
          <Icon name={paused ? "play" : "pause"} size={15} />
        </button>
      )}
      <span
        aria-hidden="true"
        style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${ratio * 100}%`, background: rail, transition: "width 1s linear, background-color var(--duration-base) var(--ease-standard)" }}
      />
      <style>{`@keyframes nine-blink{0%,100%{opacity:1}50%{opacity:.55}}@media (prefers-reduced-motion:reduce){[style*="nine-blink"]{animation:none!important}}@media (pointer:coarse){.exam-timer-pause{position:relative}.exam-timer-pause::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px}}`}</style>
    </div>
  );
}
