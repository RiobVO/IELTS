"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";

/**
 * Recorder edge-state card (handoff §2). A single calm, instructive card — never a
 * red alarm — for the four recording failure modes plus a generic error. Neutral
 * surface, 64px icon chip, title, ≤30ch body, a sky info hint, and a full-width
 * secondary action. Retryable kinds re-run getUserMedia; the unsupported-browser
 * kind has no retry (nothing to do but switch browser), so its CTA is a static note.
 */
export type EdgeKind = "denied" | "no_device" | "busy" | "unsupported" | "error";

const COPY: Record<EdgeKind, { icon: IconName; title: string; body: string; hint: string; cta: string; retry: boolean }> = {
  denied: {
    icon: "mic-off",
    title: "Microphone access is blocked",
    body: "We can't hear you until your browser allows the mic for bando.",
    hint: "Click the lock icon in the address bar and set Microphone to Allow, then try again.",
    cta: "How to allow the mic",
    retry: true,
  },
  no_device: {
    icon: "mic",
    title: "No microphone detected",
    body: "Your device isn't reporting a mic we can record from.",
    hint: "Plug in a microphone or check your system sound settings, then try again.",
    cta: "Try again",
    retry: true,
  },
  busy: {
    icon: "clock",
    title: "Your mic is in use",
    body: "Another app is holding the microphone, so we can't record right now.",
    hint: "Close Zoom, Meet, or any voice-memo app using the mic, then try again.",
    cta: "Try again",
    retry: true,
  },
  unsupported: {
    icon: "globe",
    title: "This browser can't record",
    body: "Your browser doesn't support in-page recording for Speaking.",
    hint: "Open bando in an up-to-date Chrome or Safari to record your answer.",
    cta: "Open bando in Chrome or Safari to record",
    retry: false,
  },
  error: {
    icon: "alert-triangle",
    title: "We couldn't start recording",
    body: "Something interrupted the microphone before we could begin.",
    hint: "Check your mic and browser permissions, then try again.",
    cta: "Try again",
    retry: true,
  },
};

export function EdgeCard({ kind, onRetry }: { kind: EdgeKind; onRetry?: () => void }) {
  const c = COPY[kind];
  return (
    <div style={S.card}>
      <span style={S.chip} aria-hidden="true">
        <Icon name={c.icon} size={28} strokeWidth={2} style={{ color: "var(--text-muted)" }} />
      </span>
      <div style={S.title}>{c.title}</div>
      <p style={S.body}>{c.body}</p>
      <div style={S.hintRow}>
        <Icon name="info" size={16} strokeWidth={2.2} style={{ color: "var(--info)", flex: "none", marginTop: 1 }} />
        <span style={S.hintText}>{c.hint}</span>
      </div>
      <div style={{ width: "100%", marginTop: 4 }}>
        {c.retry && onRetry ? (
          <Button variant="secondary" fullWidth onClick={onRetry}>{c.cta}</Button>
        ) : (
          <div role="note" style={S.staticCta}>{c.cta}</div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  card: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12, background: "var(--surface)", border: "2px solid var(--border-strong)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 28, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  chip: { display: "grid", placeItems: "center", width: 64, height: 64, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", border: "1px solid var(--border)" },
  title: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.25, color: "var(--text-primary)" },
  body: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)", maxWidth: "30ch" },
  hintRow: { width: "100%", display: "flex", gap: 9, alignItems: "flex-start", textAlign: "left", background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12, marginTop: 2 },
  hintText: { fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" },
  staticCta: { width: "100%", display: "grid", placeItems: "center", minHeight: 50, padding: "0 16px", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", fontSize: 14, fontWeight: 700 },
};
