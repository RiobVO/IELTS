"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Logo } from "@/components/core/Logo";
import { createClient } from "@/lib/supabase/client";

/**
 * Шаг 1 сброса пароля: e-mail → Supabase шлёт recovery-ссылку, которая ведёт на
 * /auth/callback?next=/auth/update-password (callback обменяет код на сессию и
 * уведёт на форму нового пароля). Тот же e-mail-канал, что и подтверждение signup.
 */
export default function ResetPasswordPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!email) return;

    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/auth/update-password`,
    });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", padding: "40px 36px" }}>
        <a href="/" style={{ display: "inline-flex", marginBottom: 26, textDecoration: "none" }} aria-label="bando home">
          <Logo size={28} />
        </a>

        {status === "sent" ? (
          <>
            <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Check your email</h1>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 24px" }}>If an account exists for that address, a password reset link is on its way. The link opens a page to set a new password.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Reset your password</h1>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 22px" }}>Enter the email you signed up with and we&apos;ll send a reset link.</p>

            {error && (
              <div style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 12 }}>{error}</div>
            )}

            <form onSubmit={onSubmit}>
              <Input icon="pen-line" name="email" type="email" placeholder="Email" required autoComplete="email" />
              <div style={{ marginTop: 18 }}>
                <Button size="lg" fullWidth trailingIcon="arrow-right" type="submit" loading={status === "sending"}>Send reset link</Button>
              </div>
            </form>
          </>
        )}

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <a href="/auth" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-link)" }}>Back to log in</a>
        </div>
      </div>
    </div>
  );
}
