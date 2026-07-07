"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { Button } from "@/components/core/Button";
import { Logo } from "@/components/core/Logo";
import { createClient } from "@/lib/supabase/client";

/** Cooldown между переотправками письма. Supabase держит собственный минимальный
 *  интервал между письмами — блокируем кнопку на это же окно, чтобы юзер не ловил
 *  rate-limit при частых кликах. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Персистентная подпись/ссылка «назад» — тот же паттерн, что на reset/update-password. */
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

/** Ошибки resend → человекочитаемые БЕЗ раскрытия статуса аккаунта. */
function friendlyResendError(raw: string): string {
  const m = raw.toLowerCase();
  if (
    m.includes("rate") ||
    m.includes("security purposes") ||
    m.includes("only request")
  ) {
    return "Please wait a moment before requesting another email.";
  }
  // Anti-enumeration: «already confirmed» и прочие статусы аккаунта НЕ раскрываем —
  // ?email= attacker-controlled, различимый ответ был бы оракулом существования
  // адреса. Единый неопределённый текст для всех не-rate-limit исходов.
  return "If that address needs confirmation, a link is on its way.";
}

/**
 * Клиентский экран подтверждения почты: показываем адрес, куда ушла ссылка, и даём
 * переотправить письмо (supabase.auth.resend, type: "signup") с cooldown. justSent
 * (сразу после signUp) → cooldown стартует заряженным (письмо только что ушло); для
 * входа с неподтверждённым email resend доступен сразу.
 */
export function CheckEmail({
  email,
  justSent,
}: {
  email: string;
  justSent: boolean;
}) {
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_SECONDS : 0);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Обратный отсчёт: setTimeout пересоздаётся на каждое изменение cooldown, сам
  // останавливается на нуле и чистится при размонтировании.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (cooldown > 0 || sending) return;
    setSending(true);
    setError(null);
    setResent(false);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setSending(false);
    // Запускаем cooldown в любом исходе (и успех, и rate-limit) — не даём молотить
    // эндпоинт письмами.
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (error) {
      setError(friendlyResendError(error.message));
      return;
    }
    setResent(true);
  }

  const resendLabel = sending
    ? "Sending…"
    : cooldown > 0
      ? `Resend in ${cooldown}s`
      : "Resend email";

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <div style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", padding: "40px 36px" }}>
        <a href="/" style={{ display: "inline-flex", marginBottom: 26, textDecoration: "none" }} aria-label="bando home">
          <Logo size={28} />
        </a>

        <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 6px" }}>Check your email</h1>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 4px" }}>We sent a confirmation link to</p>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 20px", wordBreak: "break-all" }}>{email}</p>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 22px" }}>Click the link in that email to activate your account. It can take a minute to arrive — check your spam folder too.</p>

        {error && (
          <div role="alert" style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 12 }}>{error}</div>
        )}
        {resent && !error && (
          <div role="status" style={{ background: "var(--success-subtle)", color: "var(--success-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 12 }}>Sent — a fresh link is on its way.</div>
        )}

        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-secondary)", margin: "0 0 8px" }}>Didn&apos;t get it?</p>
        <Button size="lg" variant="secondary" fullWidth type="button" onClick={resend} loading={sending} disabled={cooldown > 0}>
          {resendLabel}
        </Button>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <a href="/auth" style={backLinkStyle}>Back to log in</a>
        </div>
      </div>
    </main>
  );
}
