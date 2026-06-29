import type { Metadata } from "next";
import { Logo } from "@/components/core/Logo";
import { findPlan } from "@/lib/payments/plans";
import { speakingEvalConfig } from "@/env";
import PricingScreen from "../app/upgrade/PricingScreen";

export const metadata: Metadata = {
  title: "Pricing — bando",
  description:
    "Start free. Upgrade to Premium to see exactly which IELTS question types cost you points, with explanations and full mock tests.",
};

const headLink: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 700,
  textDecoration: "none",
};

const footLink: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textDecoration: "none",
};

/**
 * Public pricing page — the plan table is shared with /app/upgrade (one source
 * of truth for tiers + prices), rendered in guest mode: CTAs route to sign-up
 * instead of starting a payment. Own light header/footer (no AppShell, which is
 * auth-gated). Static — prices come from the PLANS catalog at build/request.
 */
export default function PricingPage() {
  const price = {
    premium: { monthly: findPlan("premium", 1)!.amount, annual: findPlan("premium", 12)!.amount },
    ultra: { monthly: findPlan("ultra", 1)!.amount, annual: findPlan("ultra", 12)!.amount },
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <a href="/" style={{ display: "inline-flex", textDecoration: "none" }} aria-label="bando home"><Logo size={26} /></a>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <a href="/auth" style={{ ...headLink, color: "var(--text-secondary)" }}>Log in</a>
            <a href="/auth?next=/app/upgrade" style={{ ...headLink, color: "var(--text-link)" }}>Start free →</a>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 1000, margin: "0 auto" }}>
        <PricingScreen current="basic" price={price} ctaHref="/auth?next=/app/upgrade" speakingEnabled={speakingEvalConfig() !== null} />
      </main>

      <footer style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>© 2026 bando · Stop guessing your band.</span>
          <nav style={{ display: "flex", gap: 18 }}>
            <a href="/about" style={footLink}>About</a>
            <a href="/privacy" style={footLink}>Privacy</a>
            <a href="/terms" style={footLink}>Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
