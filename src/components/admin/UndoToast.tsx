"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SubmitButton } from "./AdminSubmit";

/**
 * UndoToast — обратимый пост-экшн тост для статус-флипов на /admin. Действие уже
 * произошло на сервере (архитектура full-round-trip, не оптимистичная), тост даёт
 * escape-hatch: форма постит обратный setStatus. Появляется по ?done/&did, сам гаснет
 * через ~9с. reverseAction прокидывается как server-action проп.
 */
const CSS = `
@keyframes adm-toast-in{from{opacity:0;transform:translate(-50%,120%)}to{opacity:1;transform:translate(-50%,0)}}
.adm-toast{animation:adm-toast-in .32s var(--ease-out) both}
@media (prefers-reduced-motion:reduce){.adm-toast{animation:none}}
`;

export function UndoToast({
  message,
  reverseAction,
  id,
  reverseStatus,
}: {
  message: string;
  reverseAction: (formData: FormData) => void;
  id: string;
  reverseStatus: "draft" | "published";
}) {
  const [open, setOpen] = useState(true);
  // key по id — новое действие пере-монтирует тост (иначе таймер прошлого гасил бы новый).
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    setOpen(true);
    timer.current = setTimeout(() => setOpen(false), 9000);
    return () => clearTimeout(timer.current);
  }, [id, message]);

  if (!open) return null;
  return (
    <>
      <style>{CSS}</style>
      <div className="adm-toast" style={S.toast} role="status">
        <span style={S.msg}>{message}</span>
        <form action={reverseAction} style={S.form}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={reverseStatus} />
          <SubmitButton size="sm" variant="inverse">Undo</SubmitButton>
        </form>
        <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" style={S.close}>
          ×
        </button>
      </div>
    </>
  );
}

const S: Record<string, CSSProperties> = {
  toast: {
    position: "fixed",
    left: "50%",
    bottom: "calc(20px + env(safe-area-inset-bottom))",
    // z 40 — выше sticky-нава (30), ниже tooltip (90).
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    gap: 14,
    maxWidth: "min(560px, calc(100vw - 32px))",
    padding: "10px 12px 10px 18px",
    background: "var(--surface-inverse)",
    color: "var(--surface-inverse-ink)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
  },
  msg: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 0 },
  form: { flexShrink: 0 },
  close: {
    flexShrink: 0,
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    background: "transparent",
    border: "none",
    color: "var(--surface-inverse-ink)",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    opacity: 0.7,
    borderRadius: "var(--radius-sm)",
  },
};
