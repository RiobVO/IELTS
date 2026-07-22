import type * as React from "react";
import { Logo } from "@/components/core/Logo";

interface InfoPageProps {
  title: string;
  /** Дата последнего обновления, напр. "June 2026" — показывается под заголовком. */
  updated?: string;
  /** Вводный абзац крупнее основного текста. */
  lead?: string;
  children: React.ReactNode;
}

// Типографика прозы — обычный CSS в <style> (как keyframes в AuthScreen), не
// CSS-in-JS: инлайн-стили не каскадируют на h2/p/ul внутри children.
const PROSE = `
.legal-prose h2 { font-family: var(--font-ui); font-size: var(--text-xl); font-weight: 800; letter-spacing: var(--tracking-tight); color: var(--text-primary); margin: 34px 0 10px; }
.legal-prose p { margin: 0 0 16px; }
.legal-prose ul { margin: 0 0 16px; padding-left: 20px; }
.legal-prose li { margin: 0 0 8px; }
.legal-prose a { color: var(--text-link); font-weight: 600; text-decoration: none; }
.legal-prose a:hover { text-decoration: underline; }
.legal-prose strong { color: var(--text-primary); font-weight: 700; }
`;

const footLink: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textDecoration: "none",
};

/**
 * InfoPage — общий каркас статических страниц (About / Privacy / Terms): top-bar
 * с логотипом-домой, колонка прозы, нижний бар с перекрёстными ссылками. bando-токены.
 */
export function InfoPage({ title, updated, lead, children }: InfoPageProps) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <style>{PROSE}</style>

      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ display: "inline-flex", textDecoration: "none" }} aria-label="bando home"><Logo size={26} /></a>
          <a href="/auth" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)", textDecoration: "none" }}>Start free →</a>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 760, margin: "0 auto", padding: "56px 24px 80px" }}>
        <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "0 0 12px" }}>{title}</h1>
        {updated && <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0 0 28px" }}>Last updated {updated}</p>}
        {lead && <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", lineHeight: 1.6, color: "var(--text-secondary)", margin: "0 0 32px" }}>{lead}</p>}
        <div className="legal-prose" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", lineHeight: 1.7, color: "var(--text-secondary)" }}>
          {children}
        </div>
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
