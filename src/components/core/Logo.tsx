"use client";

import type * as React from "react";

interface LogoProps {
  size?: number;       // высота знака, px. @default 30
  showWordmark?: boolean; // @default true
  style?: React.CSSProperties;
}

export function Logo({ size = 30, showWordmark = true, style }: LogoProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--text-primary)", ...style }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none"
        role={showWordmark ? undefined : "img"}
        aria-label={showWordmark ? undefined : "bando"}
        aria-hidden={showWordmark || undefined}
        style={{ display: "block", flex: "none" }}>
        <rect x="9" y="18" width="34" height="9" rx="4.5" fill="var(--brand)" />
        <rect x="9" y="31" width="46" height="9" rx="4.5" fill="currentColor" opacity="0.92" />
        <rect x="9" y="44" width="22" height="9" rx="4.5" fill="currentColor" opacity="0.5" />
      </svg>
      {showWordmark && (
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "1.25rem", letterSpacing: "var(--tracking-tight)" }}>
          band<span style={{ color: "var(--brand)" }}>o</span>
        </span>
      )}
    </span>
  );
}
