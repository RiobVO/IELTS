"use client";

import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Logo } from "@/components/core/Logo";
import { requestPasswordReset } from "../actions";

/** Персистентная подпись поля (htmlFor) — recall + скринридер; плейсхолдер её не заменяет. */
const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const backLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 10px",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  color: "var(--text-link)",
};

/**
 * Шаг 1 сброса пароля: e-mail → Supabase шлёт recovery-ссылку, которая ведёт на
 * /auth/callback?next=/auth/update-password (callback обменяет код на сессию и
 * уведёт на форму нового пароля). Тот же e-mail-канал, что и подтверждение signup.
 */
export default function ResetPasswordPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  // Успех меняет весь блок формы → фокус улетает в body. Переносим его на новый
  // заголовок (role=status анонсирует смену состояния скринридеру).
  useEffect(() => {
    if (status === "sent") sentHeadingRef.current?.focus();
  }, [status]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!email) return;

    setStatus("sending");
    setError(null);
    // Серверный action (не браузерный supabase-вызов): нужен доступ к IP для
    // троттлинга (§11 anti-abuse) — см. requestPasswordReset в ../actions.
    const { error } = await requestPasswordReset(email);
    if (error) {
      setError(error);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", padding: "40px 36px" }}>
        <a href="/" style={{ display: "inline-flex", marginBottom: 26, textDecoration: "none" }} aria-label="bando home">
          <Logo size={28} />
        </a>

        {status === "sent" ? (
          <div role="status">
            <h1 ref={sentHeadingRef} tabIndex={-1} style={{ outline: "none", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Check your email</h1>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 24px" }}>If an account exists for that address, a password reset link is on its way. The link opens a page to set a new password.</p>
          </div>
        ) : (
          <>
            <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Reset your password</h1>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 22px" }}>Enter the email you signed up with and we&apos;ll send a reset link.</p>

            {error && (
              <div role="alert" style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 12 }}>{error}</div>
            )}

            <form onSubmit={onSubmit}>
              <label htmlFor="reset-email" style={labelStyle}>Email</label>
              <Input id="reset-email" icon="mail" name="email" type="email" placeholder="you@example.com" required autoComplete="email" autoFocus />
              <div style={{ marginTop: 18 }}>
                <Button size="lg" fullWidth trailingIcon="arrow-right" type="submit" loading={status === "sending"}>Send reset link</Button>
              </div>
            </form>
          </>
        )}

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <a href="/auth" style={backLinkStyle}>Back to log in</a>
        </div>
      </div>
    </main>
  );
}
