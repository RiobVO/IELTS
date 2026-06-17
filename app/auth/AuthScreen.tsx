"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { createClient } from "@/lib/supabase/client";
import { signIn, signUp } from "./actions";

interface AuthScreenProps {
  error?: string;
  message?: string;
  refCode?: string;
  next: string;
  /** Cloudflare Turnstile site key — when set, the signup form renders the
   *  anti-bot widget. Absent = gate off (the server seam is fail-open too). */
  turnstileSiteKey?: string;
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

export function AuthScreen({ error, message, refCode, next, turnstileSiteKey }: AuthScreenProps) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [phase, setPhase] = useState<"idle" | "cover" | "reveal">("idle");
  const [reveal, setReveal] = useState(0);
  const t1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (t1.current) clearTimeout(t1.current);
    if (t2.current) clearTimeout(t2.current);
  }, []);

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

  const switchTo = (target: "signup" | "login") => {
    if (target === mode || phase !== "idle") return;
    setPhase("cover");
    t1.current = setTimeout(() => {
      setMode(target);
      setReveal((r) => r + 1);
      setPhase("reveal");
      t2.current = setTimeout(() => setPhase("idle"), 720);
    }, 430);
  };

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
  const PANEL = 46;

  let pLeft = signup ? (100 - PANEL) : 0;
  let pW = PANEL;
  if (phase === "cover") { pLeft = 0; pW = 100; }
  const covering = phase === "cover";

  // Suppress unused variable warning — reveal is used to force re-render on switch
  void reveal;

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "var(--bg-base)" }}>
      <style>{`
        @keyframes auth-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        .auth-rise{animation:auth-rise .5s var(--ease-out) both}
        @keyframes seal-spin{to{transform:rotate(360deg)}}
        @keyframes mark-pop{0%{transform:scale(.4);opacity:0}55%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
        @media (prefers-reduced-motion:reduce){.auth-rise,.auth-seal,.auth-mark{animation:none!important}}
      `}</style>

      <div style={{ position: "relative", width: 940, maxWidth: "100%", height: 580, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-xl)", overflow: "hidden" }}>

        {/* Signup form — LEFT half */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: (100 - PANEL) + "%", display: "grid", placeItems: "center", padding: "40px 36px", opacity: signup && phase !== "cover" ? 1 : 0, pointerEvents: signup && phase === "idle" ? "auto" : "none", transition: "opacity .3s var(--ease-out)" }}>
          {signup && (
            <div style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
              <div className="auth-rise" style={{ animationDelay: "40ms" }}>
                <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" }}>Create your account</h1>
                <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 22px" }}>Your first full test is free. No card.</p>
              </div>

              {(error || message || refCode) && (
                <div className="auth-rise" style={{ animationDelay: "60ms", marginBottom: 12 }}>
                  {error && (
                    <div style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{error}</div>
                  )}
                  {message && (
                    <div style={{ background: "var(--success-subtle)", color: "var(--success-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{message}</div>
                  )}
                  {refCode && (
                    <div style={{ background: "var(--brand-subtle)", color: "var(--text-link)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)" }}>Referral sign-up — you and your inviter both get a bonus.</div>
                  )}
                </div>
              )}

              <form action={signUp}>
                <input type="hidden" name="ref" value={refCode ?? ""} />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="auth-rise" style={{ animationDelay: "90ms" }}>
                    <Input icon="graduation-cap" name="name" placeholder="Your name" />
                  </div>
                  <div className="auth-rise" style={{ animationDelay: "160ms" }}>
                    <Input icon="pen-line" name="email" type="email" placeholder="Email" required autoComplete="email" />
                  </div>
                  <div className="auth-rise" style={{ animationDelay: "230ms" }}>
                    <Input icon="lock" name="password" type="password" placeholder="Password" required minLength={6} autoComplete="new-password" />
                  </div>
                </div>
                {turnstileSiteKey && (
                  <div
                    className="auth-rise cf-turnstile"
                    data-sitekey={turnstileSiteKey}
                    style={{ marginTop: 14, animationDelay: "270ms" }}
                  />
                )}
                <div className="auth-rise" style={{ marginTop: 18, animationDelay: "300ms" }}>
                  <Button size="lg" fullWidth trailingIcon="arrow-right" type="submit">Create account</Button>
                </div>
              </form>

              <div className="auth-rise" style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", animationDelay: "360ms" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>or</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div className="auth-rise" style={{ animationDelay: "410ms" }}>
                <button type="button" onClick={googleSignIn} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 46, width: "100%", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 0 0 var(--neutral-edge)" }}>
                  <GoogleG /> Continue with Google
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Login form — RIGHT half */}
        <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: (100 - PANEL) + "%", display: "grid", placeItems: "center", padding: "40px 36px", opacity: !signup && phase !== "cover" ? 1 : 0, pointerEvents: !signup && phase === "idle" ? "auto" : "none", transition: "opacity .3s var(--ease-out)" }}>
          {!signup && (
            <div style={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
              <div className="auth-rise" style={{ animationDelay: "40ms" }}>
                <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" }}>Welcome back</h1>
                <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 22px" }}>Pick up where you left off.</p>
              </div>

              {(error || message || refCode) && (
                <div className="auth-rise" style={{ animationDelay: "60ms", marginBottom: 12 }}>
                  {error && (
                    <div style={{ background: "var(--error-subtle)", color: "var(--error-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{error}</div>
                  )}
                  {message && (
                    <div style={{ background: "var(--success-subtle)", color: "var(--success-text)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", marginBottom: 6 }}>{message}</div>
                  )}
                  {refCode && (
                    <div style={{ background: "var(--brand-subtle)", color: "var(--text-link)", padding: "8px 12px", borderRadius: "var(--radius-md)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)" }}>Referral sign-up — you and your inviter both get a bonus.</div>
                  )}
                </div>
              )}

              <form action={signIn}>
                <input type="hidden" name="next" value={next} />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="auth-rise" style={{ animationDelay: "90ms" }}>
                    <Input icon="pen-line" name="email" type="email" placeholder="Email" required autoComplete="email" />
                  </div>
                  <div className="auth-rise" style={{ animationDelay: "160ms" }}>
                    <Input icon="lock" name="password" type="password" placeholder="Password" required minLength={6} autoComplete="current-password" />
                  </div>
                </div>
                <div className="auth-rise" style={{ textAlign: "right", marginTop: 10, animationDelay: "260ms" }}>
                  <a href="/auth/reset" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-link)" }}>Forgot password?</a>
                </div>
                <div className="auth-rise" style={{ marginTop: 18, animationDelay: "300ms" }}>
                  <Button size="lg" fullWidth trailingIcon="arrow-right" type="submit">Log in</Button>
                </div>
              </form>

              <div className="auth-rise" style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", animationDelay: "360ms" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>or</span>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div className="auth-rise" style={{ animationDelay: "410ms" }}>
                <button type="button" onClick={googleSignIn} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 46, width: "100%", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 0 0 var(--neutral-edge)" }}>
                  <GoogleG /> Continue with Google
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sliding violet panel */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: pLeft + "%", width: pW + "%", padding: covering ? 0 : 10, zIndex: 5, transition: "left .62s var(--ease-in-out), width .62s var(--ease-in-out), padding .62s var(--ease-in-out)" }}>
          <div style={{ position: "relative", overflow: "hidden", height: "100%", background: "linear-gradient(165deg, #2A2342, #14101F)", borderRadius: covering ? "var(--radius-2xl)" : "var(--radius-xl)", display: "flex", flexDirection: "column", justifyContent: "center", padding: "44px 40px", color: "#fff", transition: "border-radius .5s var(--ease-in-out)" }}>
            <div aria-hidden="true" style={{ position: "absolute", top: -120, right: -90, width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 55%, transparent), transparent 65%)", filter: "blur(36px)", opacity: 0.5 }} />
            <div aria-hidden="true" style={{ position: "absolute", bottom: -110, left: -70, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--info) 45%, transparent), transparent 65%)", filter: "blur(40px)", opacity: 0.4 }} />

            {/* COVER state: centered pulsing mark */}
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: covering ? 1 : 0, transition: "opacity .3s var(--ease-out)" }}>
              <div style={{ position: "relative", width: 96, height: 96 }}>
                <div className="auth-seal" style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px dashed rgba(255,255,255,.4)", animation: covering ? "seal-spin 4s linear infinite" : "none" }} />
                <div className="auth-mark" style={{ position: "absolute", inset: 16, borderRadius: 20, background: "rgba(255,255,255,.10)", display: "grid", placeItems: "center", animation: covering ? "mark-pop .5s var(--ease-out) both" : "none" }}>
                  <img src="/bando-mark.svg" width="34" height="34" alt="" />
                </div>
              </div>
            </div>

            {/* IDLE/REVEAL copy */}
            <div style={{ position: "relative", minHeight: 150, opacity: covering ? 0 : 1, transition: "opacity .35s var(--ease-out) .15s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 28 }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)" }}>
                  <img src="/bando-mark.svg" width="20" height="20" alt="" />
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 21, color: "#fff" }}>band<span style={{ color: "var(--violet-300)" }}>o</span></span>
              </div>
              <h2 style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 26, lineHeight: 1.15, letterSpacing: "-.02em", margin: "0 0 10px", maxWidth: 280 }}>{signup ? "Already with us?" : "New to bando?"}</h2>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,.66)", lineHeight: 1.55, margin: "0 0 22px", maxWidth: 270 }}>{signup ? "Log in and keep your streak, league rank and progress moving." : "Take a free test and see exactly which question types cost you points."}</p>
              <button onClick={() => switchTo(signup ? "login" : "signup")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 46, padding: "0 22px", borderRadius: "var(--radius-md)", border: "2px solid rgba(255,255,255,.5)", background: "transparent", color: "#fff", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer" }}>
                {signup ? "Log in" : "Create account"} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
