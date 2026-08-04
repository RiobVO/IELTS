"use client";

import { type CSSProperties, type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Logo } from "@/components/core/Logo";
import { createClient } from "@/lib/supabase/client";

/** Персистентная подпись поля (htmlFor) — recall + скринридер; плейсхолдер её не заменяет. */
const labelStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  letterSpacing: "var(--tracking-tight)",
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
 * Шаг 2 сброса пароля: пользователь приходит сюда из recovery-ссылки уже с
 * сессией (callback обменял код). updateUser({ password }) меняет пароль, после
 * чего пользователь авторизован → ведём в /app. Без сессии Supabase вернёт
 * ошибку — показываем её, это реальный путь, не заглушка.
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "saving") return;
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");

    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }

    setStatus("saving");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("done");
    router.push("/app");
    router.refresh();
  }

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", padding: "40px 36px" }}>
        <a href="/" style={{ display: "inline-flex", marginBottom: 26, textDecoration: "none" }} aria-label="bando home">
          <Logo size={28} />
        </a>

        <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Set a new password</h1>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 22px" }}>Choose a new password for your account. Minimum 6 characters.</p>

        {error && (
          <div role="alert" style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 12 }}>{error}</div>
        )}

        <form onSubmit={onSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label htmlFor="new-password" style={labelStyle}>New password</label>
              <Input id="new-password" icon="lock" name="password" type="password" placeholder="At least 6 characters" required minLength={6} autoComplete="new-password" autoFocus />
            </div>
            <div>
              <label htmlFor="confirm-password" style={labelStyle}>Confirm new password</label>
              <Input id="confirm-password" icon="lock" name="confirm" type="password" placeholder="Re-enter password" required minLength={6} autoComplete="new-password" />
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <Button size="lg" fullWidth trailingIcon="arrow-right" type="submit" loading={status === "saving" || status === "done"}>Update password</Button>
          </div>
        </form>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <a href="/auth" style={backLinkStyle}>Back to log in</a>
        </div>
      </div>
    </div>
  );
}
