import Link from "next/link";
import { Logo } from "@/components/core/Logo";
import { Button } from "@/components/core/Button";
import { Card } from "@/components/core/Card";
import { FeatureGrid, type Feature } from "@/components/marketing/FeatureGrid";

const IMG = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/";
const FEATURES: Feature[] = [
  { image: IMG + "Stopwatch/3D/stopwatch_3d.png",   title: "Real exam mode",     description: "Computer-delivered IELTS: timer, navigator, mark-for-review." },
  { image: IMG + "Bar%20chart/3D/bar_chart_3d.png", title: "Per-type breakdown", description: "Every question type ranked worst-first, so you fix the right thing." },
  { image: IMG + "Memo/3D/memo_3d.png",             title: "Targeted drills",    description: "Practise only the type that's costing you band." },
  { image: IMG + "Books/3D/books_3d.png",           title: "Full mock tests",    description: "Complete 40-question papers with a projected band." },
];
const TIERS: { name: string; line: string; highlight?: boolean }[] = [
  { name: "Basic",   line: "Free. A daily test limit and the core breakdown." },
  { name: "Premium", line: "Unlimited tests, full breakdown with evidence, analytics and history.", highlight: true },
  { name: "Ultra",   line: "Everything in Premium plus AI Writing/Speaking scoring (coming soon)." },
];

export default function Home() {
  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1120, margin: "0 auto", padding: "20px 24px" }}>
        <Logo />
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/auth" style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "var(--text-sm)" }}>Log in</Link>
          <Link href="/auth"><Button>Start free</Button></Link>
        </div>
      </nav>

      {/* Hero */}
      <header style={{ maxWidth: 880, margin: "0 auto", padding: "72px 24px 56px", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-5xl)", fontWeight: 800, lineHeight: "var(--leading-tight)", letterSpacing: "var(--tracking-tighter)", margin: 0 }}>
          Stop guessing your <span style={{ color: "var(--brand)" }}>band.</span>
        </h1>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", color: "var(--text-muted)", maxWidth: 560, margin: "20px auto 0", lineHeight: "var(--leading-relaxed)" }}>
          See exactly where you lose points across every IELTS Reading and Listening question type — then drill that weakness until it&apos;s gone.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32 }}>
          <Link href="/auth"><Button size="lg" trailingIcon="arrow-right">Get your band</Button></Link>
          <Link href="#pricing"><Button size="lg" variant="secondary">See pricing</Button></Link>
        </div>
      </header>

      {/* The bando difference */}
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "8px 24px 64px", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand)" }}>The bando difference</span>
        <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "12px 0 0" }}>
          More tests won&apos;t fix it. Knowing your type will.
        </h2>
        <p style={{ color: "var(--text-muted)", marginTop: 12, lineHeight: "var(--leading-relaxed)" }}>
          You don&apos;t have a stamina problem — you have a blind spot, and we name it.
        </p>
      </section>

      {/* How it works */}
      <section id="how" style={{ maxWidth: 980, margin: "0 auto", padding: "0 24px 72px" }}>
        <FeatureGrid features={FEATURES} columns={2} variant="tactile" />
      </section>

      {/* Pricing teaser */}
      <section id="pricing" style={{ maxWidth: 980, margin: "0 auto", padding: "0 24px 88px" }}>
        <h2 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", textAlign: "center", margin: "0 0 28px" }}>Pricing</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {TIERS.map((t) => (
            <Card key={t.name} style={t.highlight ? { borderColor: "var(--brand-border)" } : undefined}>
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 800, color: "var(--brand)" }}>{t.name}</div>
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "8px 0 0", lineHeight: "var(--leading-relaxed)" }}>{t.line}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "28px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
        <Logo size={22} /> <span style={{ marginLeft: 8 }}>· Get your band.</span>
      </footer>
    </main>
  );
}
