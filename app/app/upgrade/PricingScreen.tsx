"use client";

import { useState } from "react";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import type { Tier } from "@/lib/tiers";
import { initiatePayment } from "./actions";

interface Price {
  monthly: number;
  annual: number;
}

type CardId = "basic" | "premium" | "ultra";

interface PlanCardMeta {
  id: CardId;
  name: string;
  tagline: string;
  popular?: boolean;
  cta: string;
  features: { t: string; on: boolean; hero?: boolean }[];
}

const CARDS: PlanCardMeta[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "Get started for free.",
    cta: "Your current plan",
    features: [
      { t: "Unlimited single passages & parts", on: true },
      { t: "Score & % per test", on: true },
      { t: "Per-type breakdown", on: false },
      { t: "Answer explanations & evidence", on: false },
      { t: "Full 40-question mock tests", on: false },
      { t: "League & badges", on: true },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "See exactly where you lose points.",
    popular: true,
    cta: "Upgrade to Premium",
    features: [
      { t: "Everything in Basic", on: true },
      { t: "Per-type breakdown (the analytics)", on: true, hero: true },
      { t: "Answer explanations & evidence", on: true, hero: true },
      { t: "Full 40-question mock tests", on: true },
      { t: "Drill any weak type on demand", on: true },
      { t: "Priority new content", on: false },
    ],
  },
  {
    id: "ultra",
    name: "Ultra",
    tagline: "Everything, plus a human check.",
    cta: "Go Ultra",
    features: [
      { t: "Everything in Premium", on: true },
      { t: "Monthly band prediction report", on: true, hero: true },
      { t: "Priority new content", on: true },
      { t: "Writing & Speaking add-ons (soon)", on: true },
      { t: "1:1 strategy call (quarterly)", on: true, hero: true },
      { t: "Cancel anytime", on: true },
    ],
  },
];

const FAQ = [
  { q: "Can I cancel anytime?", a: "Yes — cancel in one tap from your profile. You keep access until the end of the billing period." },
  { q: "Is there a student discount?", a: "Premium is already priced for the region, and inviting friends earns you free Premium weeks." },
  { q: "What payment methods work?", a: "Local cards via Payme, Click and Uzum. More options are coming soon." },
];

const fmt = (tiyin: number) => new Intl.NumberFormat("en-US").format(Math.round(tiyin / 100));

export default function PricingScreen({
  current,
  price,
}: {
  current: Tier;
  price: { premium: Price; ultra: Price };
}) {
  const [annual, setAnnual] = useState(true);

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={S.eyebrow}>
          <Icon name="bar-chart" size={14} /> Unlock the analytics that move your band
        </span>
        <h1 style={S.h1}>Pick your plan</h1>
        <p style={S.lead}>
          Start free. Upgrade when you want to know <i style={{ fontFamily: "var(--font-reading)" }}>exactly</i> where you lose points.
        </p>
      </div>

      {/* Billing toggle */}
      <div style={{ display: "flex", justifyContent: "center", margin: "22px 0 30px" }}>
        <div style={S.toggle}>
          {([["monthly", "Monthly"], ["annual", "Annual"]] as const).map(([v, l]) => {
            const on = (v === "annual") === annual;
            return (
              <button key={v} onClick={() => setAnnual(v === "annual")} style={{ ...S.toggleBtn, background: on ? "var(--surface)" : "transparent", color: on ? "var(--text-primary)" : "var(--text-muted)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                {l}
                {v === "annual" && <span style={S.saveTag}>2 mo free</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Plans */}
      <div style={S.plans}>
        {CARDS.map((card) => (
          <PlanCard key={card.id} card={card} current={current} annual={annual} price={price} />
        ))}
      </div>

      {/* Trust line */}
      <div style={S.trust}>
        {["Cancel anytime", "Local cards accepted", "Free first full test"].map((t) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Icon name="circle-check" size={15} style={{ color: "var(--success-text)" }} /> {t}
          </span>
        ))}
      </div>

      {/* FAQ */}
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <h2 style={S.faqHead}>Questions</h2>
        {FAQ.map((item, i) => (
          <FaqRow key={i} q={item.q} a={item.a} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  card,
  current,
  annual,
  price,
}: {
  card: PlanCardMeta;
  current: Tier;
  annual: boolean;
  price: { premium: Price; ultra: Price };
}) {
  const pop = !!card.popular;
  const isCurrent = current === card.id;
  const paid = card.id !== "basic";
  const p = paid ? price[card.id as "premium" | "ultra"] : null;
  const perMonth = p ? (annual ? Math.round(p.annual / 12) : p.monthly) : 0;

  return (
    <div
      style={{
        position: "relative",
        background: pop ? "linear-gradient(180deg, var(--brand-subtle), var(--surface))" : "var(--surface)",
        border: `2px solid ${pop ? "var(--brand)" : "var(--border)"}`,
        borderRadius: "var(--radius-xl)",
        boxShadow: pop ? "var(--shadow-lg)" : "var(--shadow-solid)",
        padding: "26px 24px",
        marginTop: pop ? -8 : 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {pop && (
        <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
          <span style={S.ribbon}>
            <Icon name="flame" size={12} /> Most popular
          </span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
        <span style={S.planName}>{card.name}</span>
        {isCurrent && <Badge>Current</Badge>}
      </div>
      <div style={S.tagline}>{card.tagline}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "10px 0 18px" }}>
        {paid ? (
          <>
            <span style={{ ...S.price, color: pop ? "var(--brand)" : "var(--text-primary)" }}>{fmt(perMonth)}</span>
            <span style={S.priceUnit}>UZS{annual ? " / mo · billed yearly" : " / month"}</span>
          </>
        ) : (
          <>
            <span style={{ ...S.price, color: "var(--text-primary)" }}>Free</span>
            <span style={S.priceUnit}>forever</span>
          </>
        )}
      </div>

      {paid && !isCurrent ? (
        <form action={initiatePayment}>
          <input type="hidden" name="tier" value={card.id} />
          <input type="hidden" name="months" value={annual ? 12 : 1} />
          <input type="hidden" name="provider" value="payme" />
          <Button type="submit" size="lg" fullWidth variant={pop ? "primary" : "secondary"} trailingIcon="arrow-right">
            {card.cta}
          </Button>
        </form>
      ) : (
        <Button size="lg" fullWidth variant="secondary" disabled>
          {isCurrent ? "Current plan" : card.id === "basic" ? "Free forever" : card.cta}
        </Button>
      )}

      <ul style={{ listStyle: "none", margin: "20px 0 0", padding: 0 }}>
        {card.features.map((f, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0" }}>
            <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", marginTop: 1, background: f.on ? (f.hero ? "var(--brand)" : "var(--success-subtle)") : "var(--surface-inset)", color: f.on ? (f.hero ? "var(--text-on-brand)" : "var(--success-text)") : "var(--text-disabled)" }}>
              <Icon name={f.on ? "check" : "x"} size={12} strokeWidth={3} />
            </span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: f.hero ? 700 : 500, color: f.on ? (f.hero ? "var(--text-primary)" : "var(--text-secondary)") : "var(--text-disabled)", lineHeight: 1.4 }}>{f.t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px 4px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
        <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)" }}>{q}</span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} style={{ color: "var(--text-muted)", flex: "none" }} />
      </button>
      {open && <div style={{ padding: "0 4px 16px", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, maxWidth: 620 }}>{a}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: "38px 28px 56px" },
  eyebrow: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "5px 14px", borderRadius: "var(--radius-full)", marginBottom: 14 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 8px" },
  lead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-muted)", margin: 0 },

  toggle: { display: "inline-flex", alignItems: "center", gap: 4, padding: 4, background: "var(--surface-inset)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-full)" },
  toggleBtn: { display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 18px", border: "none", borderRadius: "var(--radius-full)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer" },
  saveTag: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 7px", borderRadius: "var(--radius-full)" },

  plans: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, alignItems: "start", maxWidth: 920, margin: "0 auto" },
  ribbon: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", padding: "5px 12px", borderRadius: "var(--radius-full)", boxShadow: "0 3px 0 0 var(--brand-edge)" },
  planName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)" },
  tagline: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", minHeight: 38, lineHeight: 1.4 },
  price: { fontFamily: "var(--font-ui)", fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em" },
  priceUnit: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },

  trust: { display: "flex", justifyContent: "center", gap: 22, flexWrap: "wrap", margin: "30px 0 38px", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  faqHead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)", textAlign: "center", margin: "0 0 12px" },
};
