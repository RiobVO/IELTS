"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
import { recordConsent } from "../../../app/app/speaking/actions";

/**
 * Biometric-consent dialog (handoff §3). Voice is biometric data, so we ask once
 * before the first recording — the copy spells out that audio is recorded, stored
 * privately, processed by a third-party AI provider (Google Gemini), and deletable.
 * "I agree" writes the consent server-side (recordConsent, Plan 2) so it covers
 * future attempts; "Not now" returns to the catalog without recording.
 *
 * A real dialog: role="dialog" + aria-modal + aria-labelledby, a focus trap, Esc =
 * "Not now", and focus returns to the trigger on close. Rendered in a portal so the
 * scrim covers the page regardless of where it mounts.
 */
const ROWS: { icon: IconName; text: ReactNode }[] = [
  { icon: "mic", text: "We record your voice so we can mark your speaking." },
  { icon: "lock", text: "Stored privately — only you can listen to it." },
  { icon: "globe", text: "Processed by a third-party AI provider (Google Gemini) to generate your feedback." },
  { icon: "trash", text: "Delete it anytime — audio and transcript go with it." },
];

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function ConsentModal({ onConsented, onCancel }: { onConsented: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  // Capture the trigger to restore focus on close; move focus into the dialog.
  useEffect(() => {
    if (!mounted) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialogRef.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [mounted]);

  // Esc closes (= "Not now"); Tab is trapped inside the dialog.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const list = Array.from(nodes);
    const first = list[0];
    const last = list[list.length - 1];
    const activeEl = document.activeElement as HTMLElement | null;
    if (e.shiftKey && activeEl === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function agree() {
    setBusy(true);
    try {
      await recordConsent();
      onConsented();
    } catch {
      // Surface the failure rather than silently swallowing — the gate would still
      // block recording, so let the user retry instead of leaving them stuck.
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div style={S.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={S.dialog}
      >
        <span style={S.iconChip} aria-hidden="true">
          <Icon name="shield-check" size={26} strokeWidth={2.2} style={{ color: "var(--brand)" }} />
        </span>
        <h2 id="consent-title" style={S.title}>Record your voice for feedback?</h2>
        <p style={S.intro}>
          Your voice is biometric data, so we ask before we ever record. Here&apos;s exactly what happens:
        </p>

        <ul style={S.list}>
          {ROWS.map((r, i) => (
            <li key={i} style={S.row}>
              <span style={S.rowIcon} aria-hidden="true">
                <Icon name={r.icon} size={17} strokeWidth={2.2} style={{ color: "var(--text-link)" }} />
              </span>
              <span style={S.rowText}>{r.text}</span>
            </li>
          ))}
        </ul>

        <div style={S.actions}>
          <Button onClick={agree} disabled={busy} loading={busy} fullWidth trailingIcon="arrow-right">
            I agree, enable recording
          </Button>
          <Button onClick={onCancel} disabled={busy} variant="ghost" fullWidth>
            Not now
          </Button>
        </div>

        <p style={S.footnote}>
          One consent covers your future attempts. Manage or revoke it anytime in Settings.
        </p>
      </div>
    </div>,
    document.body,
  );
}

const S: Record<string, CSSProperties> = {
  scrim: { position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: 18, background: "rgba(28, 24, 46, 0.5)", backdropFilter: "blur(2px)", overflowY: "auto" },
  dialog: { width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 24, boxShadow: "var(--shadow-xl)", padding: "28px 26px", outline: "none", fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  iconChip: { display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 15, background: "var(--brand-subtle)", border: "1px solid var(--brand-border)", marginBottom: 16 },
  title: { margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)", textWrap: "balance" },
  intro: { margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.55, color: "var(--text-secondary)" },
  list: { listStyle: "none", margin: "18px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 13 },
  row: { display: "flex", gap: 12, alignItems: "flex-start" },
  rowIcon: { flex: "none", display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 9, background: "var(--surface-inset)" },
  rowText: { fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" },
  actions: { display: "flex", flexDirection: "column", gap: 8, marginTop: 24 },
  footnote: { margin: "16px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" },
};
