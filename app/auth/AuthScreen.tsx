"use client";

import { useState, useEffect, type ReactNode, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Icon } from "@/components/core/icons";
import { useInteractive, RING } from "@/components/core/util";
import { createClient } from "@/lib/supabase/client";
import { signIn, signUp } from "./actions";

interface AuthScreenProps {
  error?: string;
  message?: string;
  refCode?: string;
  next: string;
  /** Форма, в которой открыть экран (после серверной ошибки возвращаемся в неё). */
  initialMode?: "signup" | "login";
  /** Введённый email, восстановленный после серверной ошибки (пароль — никогда). */
  initialEmail?: string;
  /** Cloudflare Turnstile site key — when set, the signup form renders the
   *  anti-bot widget. Absent = gate off (the server seam is fail-open too). */
  turnstileSiteKey?: string;
}

const PANEL = 46;
// Панель абсолютна (left:0, width:PANEL%); сдвиг вправо делаем transform'ом, а не
// анимацией left/width — так закрыта perf-находка layout-transition и слайд идёт по GPU.
const PANEL_SHIFT = ((100 - PANEL) / PANEL) * 100;

const LABEL_STYLE: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  letterSpacing: "var(--tracking-tight)",
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const FIELD_ERROR_STYLE: CSSProperties = {
  margin: "5px 0 0",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  color: "var(--error-text)",
};

const EYE_BTN_STYLE: CSSProperties = {
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "none",
  padding: 0,
  margin: "0 -6px 0 0",
  cursor: "pointer",
  color: "var(--text-secondary)",
  minWidth: 44,
  minHeight: 44,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Известные сырые сообщения Supabase → человекочитаемые. Неизвестное (в т.ч. уже
 *  дружелюбные кастомные строки из actions.ts) отдаём как есть — ничего не теряем. */
function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Check them, or reset your password.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "This email already has an account. Try logging in instead.";
  if (m.includes("password should be at least")) return "Password must be at least 6 characters.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Enter a valid email address.";
  if (m.includes("rate limit") || m.includes("too many requests")) return "Too many attempts. Wait a moment and try again.";
  return raw;
}

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6.3 5.3C41.5 36.8 44 31 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

/** OAuth-кнопка. Свой focus-ring через useInteractive: инлайн boxShadow (3D-грань)
 *  по специфичности бьёт глобальный :focus-visible, поэтому кольцо надо
 *  дорисовывать в тот же boxShadow — иначе клавиатурный фокус тут невидим. */
function GoogleButton({ onClick }: { onClick: () => void }) {
  const { focus, handlers } = useInteractive();
  const edge = "0 3px 0 0 var(--neutral-edge)";
  return (
    <button
      type="button"
      onClick={onClick}
      {...handlers}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 46, width: "100%", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", boxShadow: focus ? `${edge}, ${RING}` : edge }}
    >
      <GoogleG /> Continue with Google
    </button>
  );
}

/** Поле с постоянной подписью (htmlFor — recall + скринридер) и опциональной
 *  inline-ошибкой валидации под инпутом (role="alert", связана aria-describedby). */
function Field({ id, label, error, children }: { id: string; label: string; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} style={LABEL_STYLE}>{label}</label>
      {children}
      {error && <p id={`${id}-error`} role="alert" style={FIELD_ERROR_STYLE}>{error}</p>}
    </div>
  );
}

/** Email с лёгкой on-blur валидацией формата — фидбек до сабмита, не блокирующий.
 *  onBlur вешаем на обёртку (React onBlur = всплывающий focusout), а не на Input:
 *  общий Input разворачивает {...rest} после своего onBlur и перезатёр бы фокус-логику. */
function EmailField({ id, autoFocus, defaultValue }: { id: string; autoFocus?: boolean; defaultValue?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field id={id} label="Email" error={err}>
      <div
        onBlur={(e) => {
          const t = e.target as HTMLElement;
          if (t.tagName !== "INPUT") return;
          const v = (t as HTMLInputElement).value.trim();
          setErr(v && !EMAIL_RE.test(v) ? "Enter a valid email address." : null);
        }}
      >
        <Input
          id={id}
          size="lg"
          icon="mail"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
          autoFocus={autoFocus}
          defaultValue={defaultValue}
          invalid={!!err}
          aria-describedby={err ? `${id}-error` : undefined}
          onChange={() => err && setErr(null)}
        />
      </div>
    </Field>
  );
}

/** Пароль: reveal-toggle в trailing + on-blur проверка длины (только на регистрации —
 *  для логина длину чужого существующего пароля не подсказываем). onBlur — на обёртке. */
function PasswordField({ id, autoComplete }: { id: string; autoComplete: "new-password" | "current-password" }) {
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checkLen = autoComplete === "new-password";
  return (
    <Field id={id} label="Password" error={err}>
      <div
        onBlur={(e) => {
          if (!checkLen) return;
          const t = e.target as HTMLElement;
          if (t.tagName !== "INPUT") return;
          const v = (t as HTMLInputElement).value;
          setErr(v && v.length < 6 ? "At least 6 characters." : null);
        }}
      >
        <Input
          id={id}
          size="lg"
          icon="lock"
          name="password"
          type={show ? "text" : "password"}
          placeholder="At least 6 characters"
          required
          minLength={6}
          autoComplete={autoComplete}
          invalid={!!err}
          aria-describedby={err ? `${id}-error` : undefined}
          onChange={() => err && setErr(null)}
          trailing={
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              style={EYE_BTN_STYLE}
            >
              <Icon name={show ? "eye-off" : "eye"} size={17} />
            </button>
          }
        />
      </div>
    </Field>
  );
}

/** Submit-кнопка с pending-состоянием (useFormStatus): на сабмите блокируется и
 *  показывает спиннер — visibility of status + защита от двойного клика. */
function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button size="lg" fullWidth trailingIcon="arrow-right" loading={pending} type="submit">
      {children}
    </Button>
  );
}

export function AuthScreen({ error, message, refCode, next, initialMode, initialEmail, turnstileSiteKey }: AuthScreenProps) {
  const [mode, setMode] = useState<"signup" | "login">(initialMode ?? "signup");

  // Load the Turnstile script once when the gate is enabled. The widget renders
  // implicitly from the `.cf-turnstile` element below (signup is the initial
  // mode, so it's in the DOM when the script scans) and injects its token into
  // the surrounding form as the `cf-turnstile-response` field.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    if (document.querySelector(`script[src="${SRC}"]`)) return;
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, [turnstileSiteKey]);

  // OAuth-вход через клиентский Supabase: штатный путь, AuthScreen уже client.
  // redirectTo несёт исходный next — callback/route.ts обменяет код и уведёт туда.
  const googleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  };

  const signup = mode === "signup";

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <style>{`
        @keyframes auth-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        .auth-rise{animation:auth-rise .5s var(--ease-out) both}
        .auth-form input::placeholder{color:var(--text-secondary);opacity:1}
        @media (prefers-reduced-motion:reduce){
          .auth-rise{animation:none!important}
          .auth-panel{transition:none!important}
          .auth-form{transition:opacity 0s!important}
        }
        /* Мобильный (<760px): раздвижная карта — desktop-метафора. Прячем violet-панель,
           активная форма встаёт в поток на всю ширину (не absolute) и задаёт высоту карты,
           неактивная скрыта; переключение — текстовым тогглом. Так signup с Turnstile не
           обрезается фиксированной высотой. */
        .auth-toggle{display:none}
        @media (max-width:759px){
          .auth-card{height:auto!important;min-height:0!important;overflow:visible!important}
          .auth-panel{display:none}
          .auth-form{position:static!important;width:100%!important;padding:30px 20px!important;opacity:1!important;pointer-events:auto!important;transform:none!important}
          .auth-form.is-idle{display:none!important}
          .auth-toggle{display:block}
        }
      `}</style>

      <div className="auth-card" style={{ position: "relative", width: 940, maxWidth: "100%", height: 580, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", overflow: "hidden" }}>

        {/* Signup form — LEFT half */}
        <div className={`auth-form ${signup ? "is-active" : "is-idle"}`} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: (100 - PANEL) + "%", display: "grid", alignItems: "safe center", justifyItems: "center", overflowY: "auto", padding: "34px 36px", opacity: signup ? 1 : 0, pointerEvents: signup ? "auto" : "none", transition: "opacity .2s var(--ease-out)" }}>
          {signup && (
            <div style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
              <div className="auth-rise">
                <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" }}>Create your account</h1>
                <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "0 0 22px" }}>Your first full test is free. No card.</p>
              </div>

              {(error || message || refCode) && (
                <div className="auth-rise" style={{ marginBottom: 12 }}>
                  {error && (
                    <div role="alert" style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{friendlyAuthError(error)}</div>
                  )}
                  {message && (
                    <div role="status" style={{ background: "var(--success-subtle)", color: "var(--success-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{message}</div>
                  )}
                  {refCode && (
                    <div style={{ background: "var(--brand-subtle)", color: "var(--text-link)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)" }}>Referral sign-up — you and your inviter both get a bonus.</div>
                  )}
                </div>
              )}

              <form action={signUp}>
                <input type="hidden" name="ref" value={refCode ?? ""} />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="auth-rise">
                    <Field id="signup-name" label="Name">
                      <Input id="signup-name" size="lg" icon="user" name="name" placeholder="Your name" autoComplete="name" autoFocus />
                    </Field>
                  </div>
                  <div className="auth-rise">
                    <EmailField id="signup-email" defaultValue={initialEmail} />
                  </div>
                  <div className="auth-rise">
                    <PasswordField id="signup-password" autoComplete="new-password" />
                  </div>
                </div>
                {turnstileSiteKey && (
                  <div
                    className="auth-rise cf-turnstile"
                    data-sitekey={turnstileSiteKey}
                    style={{ marginTop: 14 }}
                  />
                )}
                <div className="auth-rise" style={{ marginTop: 18 }}>
                  <SubmitButton>Create account</SubmitButton>
                </div>
              </form>

              <div className="auth-rise" style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>or</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div className="auth-rise">
                <GoogleButton onClick={googleSignIn} />
              </div>

              <div className="auth-toggle" style={{ textAlign: "center", marginTop: 18, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                Already have an account?{" "}
                <button type="button" onClick={() => setMode("login")} style={{ border: "none", background: "none", padding: 0, color: "var(--text-link)", fontWeight: 700, fontFamily: "inherit", fontSize: "inherit", cursor: "pointer" }}>Log in</button>
              </div>
            </div>
          )}
        </div>

        {/* Login form — RIGHT half */}
        <div className={`auth-form ${!signup ? "is-active" : "is-idle"}`} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: (100 - PANEL) + "%", display: "grid", alignItems: "safe center", justifyItems: "center", overflowY: "auto", padding: "34px 36px", opacity: !signup ? 1 : 0, pointerEvents: !signup ? "auto" : "none", transition: "opacity .2s var(--ease-out)" }}>
          {!signup && (
            <div style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
              <div className="auth-rise">
                <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" }}>Welcome back</h1>
                <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "0 0 22px" }}>Pick up where you left off.</p>
              </div>

              {(error || message || refCode) && (
                <div className="auth-rise" style={{ marginBottom: 12 }}>
                  {error && (
                    <div role="alert" style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{friendlyAuthError(error)}</div>
                  )}
                  {message && (
                    <div role="status" style={{ background: "var(--success-subtle)", color: "var(--success-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{message}</div>
                  )}
                  {refCode && (
                    <div style={{ background: "var(--brand-subtle)", color: "var(--text-link)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)" }}>Referral sign-up — you and your inviter both get a bonus.</div>
                  )}
                </div>
              )}

              <form action={signIn}>
                <input type="hidden" name="next" value={next} />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="auth-rise">
                    <EmailField id="login-email" autoFocus defaultValue={initialEmail} />
                  </div>
                  <div className="auth-rise">
                    <PasswordField id="login-password" autoComplete="current-password" />
                  </div>
                </div>
                <div className="auth-rise" style={{ textAlign: "right", marginTop: 10 }}>
                  <a href="/auth/reset" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-link)" }}>Forgot password?</a>
                </div>
                <div className="auth-rise" style={{ marginTop: 18 }}>
                  <SubmitButton>Log in</SubmitButton>
                </div>
              </form>

              <div className="auth-rise" style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>or</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div className="auth-rise">
                <GoogleButton onClick={googleSignIn} />
              </div>

              <div className="auth-toggle" style={{ textAlign: "center", marginTop: 18, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                New to bando?{" "}
                <button type="button" onClick={() => setMode("signup")} style={{ border: "none", background: "none", padding: 0, color: "var(--text-link)", fontWeight: 700, fontFamily: "inherit", fontSize: "inherit", cursor: "pointer" }}>Create account</button>
              </div>
            </div>
          )}
        </div>

        {/* Sliding violet panel — desktop only (.auth-panel hidden <760px). Двигается
            transform'ом (translateX), не left/width — GPU-слайд, без layout-thrash. */}
        <div className="auth-panel" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: PANEL + "%", padding: 10, zIndex: 5, transform: `translateX(${signup ? PANEL_SHIFT : 0}%)`, transition: "transform .28s var(--ease-out)" }}>
          <div style={{ position: "relative", overflow: "hidden", height: "100%", background: "linear-gradient(165deg, var(--surface-premium), var(--surface-premium-deep))", borderRadius: "var(--radius-xl)", display: "flex", flexDirection: "column", justifyContent: "center", padding: "44px 40px", color: "var(--surface-premium-ink)" }}>
            <div aria-hidden="true" style={{ position: "absolute", top: -120, right: -90, width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 55%, transparent), transparent 65%)", filter: "blur(36px)", opacity: 0.5 }} />

            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 28 }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)" }}>
                  <img src="/bando-mark.svg" width="20" height="20" alt="" />
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 21, color: "var(--surface-premium-ink)" }}>band<span style={{ color: "var(--violet-300)" }}>o</span></span>
              </div>
              <h2 style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 26, lineHeight: 1.15, letterSpacing: "-.02em", margin: "0 0 10px", maxWidth: 280 }}>{signup ? "Already with us?" : "New to bando?"}</h2>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,.66)", lineHeight: 1.55, margin: "0 0 22px", maxWidth: 270 }}>{signup ? "Log in and keep your streak, league rank and progress moving." : "Take a free test and see exactly which question types cost you points."}</p>
              <button onClick={() => setMode(signup ? "login" : "signup")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 46, padding: "0 22px", borderRadius: "var(--radius-md)", border: "2px solid rgba(255,255,255,.5)", background: "transparent", color: "var(--surface-premium-ink)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer" }}>
                {signup ? "Log in" : "Create account"} <span aria-hidden="true">→</span>
              </button>
            </div>

            {/* Бренд-подпись — один осмысленный акцент вместо второго декоративного glow. */}
            <div style={{ position: "absolute", left: 40, bottom: 30, display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "var(--tracking-tight)", color: "rgba(255,255,255,.5)" }}>
              <span aria-hidden="true" style={{ width: 20, height: 1, background: "rgba(255,255,255,.32)" }} />
              Stop guessing your band.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
