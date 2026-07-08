"use client";

import { useState } from "react";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import type { Tier } from "@/lib/tiers";
import { initiatePayment, joinPaymentWaitlist } from "./actions";

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

/**
 * Plan cards. `speakingEnabled` is the SPEAKING_EVAL_MODEL ops-gate (mirror of the
 * Writing gate): only when Speaking is actually reachable do we advertise the free
 * preview ("1 free Speaking analysis to try") and drop the "(coming)" tag — so the
 * pricing copy never promises a feature the user can't reach. Ships dormant until the
 * env flips on at launch (calibration-gated), in the same deploy.
 */
function buildCards(speakingEnabled: boolean): PlanCardMeta[] {
  return [
    {
      id: "basic",
      name: "Basic",
      tagline: "Get started for free.",
      cta: "Start free",
      features: [
        { t: "Unlimited Reading & Listening practice", on: true },
        { t: "Per-type breakdown — what you miss", on: true },
        { t: "Answer explanations & evidence", on: true },
        ...(speakingEnabled ? [{ t: "1 free Speaking analysis to try", on: true, hero: true }] : []),
        { t: "League, badges & streaks", on: true },
        { t: "1 trial full mock test", on: true },
        { t: "Full 40-question mock tests + band", on: false },
        { t: "AI Writing feedback", on: false },
      ],
    },
    {
      id: "premium",
      name: "Premium",
      tagline: "Sit full mocks. Know your real band.",
      popular: true,
      cta: "Upgrade to Premium",
      features: [
        { t: "Everything in Basic, free", on: true },
        { t: "Full 40-question mock tests + real band", on: true, hero: true },
        { t: "Sit it under real exam timing", on: true },
        { t: "Drill any weak type on demand", on: true },
        { t: "AI Writing feedback — Task 1 & 2 (5/day)", on: true, hero: true },
        { t: "Priority new content", on: true },
      ],
    },
    {
      id: "ultra",
      name: "Ultra",
      tagline: "AI Speaking feedback and the highest limits.",
      cta: "Upgrade to Ultra",
      features: [
        { t: "Everything in Premium", on: true },
        { t: speakingEnabled ? "AI Speaking feedback — Part 2 long-turn" : "AI Speaking feedback — Part 2 (coming)", on: true, hero: speakingEnabled },
        { t: "AI Writing feedback — 20/day (vs 5)", on: true, hero: true },
        { t: "Priority new content", on: true },
        { t: "One-time payment — no auto-renew", on: true },
      ],
    },
  ];
}

const FAQ = [
  { q: "Is this a subscription?", a: "No — each plan is a one-time purchase for the period you pick, with no auto-renew. There's nothing to cancel: your access runs until the end of the paid period, then you're back on the free plan unless you buy again." },
  { q: "What's the difference between free and paid?", a: "Reading & Listening practice — including the per-type breakdown and full answer explanations — are free, and your first full mock test is free to try, no card. After that you pay for full 40-question mock tests with an official band score, and AI Writing feedback (AI Speaking on Ultra)." },
  { q: "Premium vs Ultra?", a: "Premium adds full 40-question mock tests with your real band, plus AI Writing feedback (5 checks a day). Ultra adds AI Speaking feedback for Part 2 and raises Writing to 20 checks a day — everything in Premium included." },
  { q: "Are the tests like the real IELTS?", a: "Yes — real Cambridge material in a runner that mirrors the computer-delivered exam: same interface, timer, drag-and-drop." },
  { q: "How accurate is the band?", a: "Reading & Listening use the official Cambridge band scale. Writing is scored by AI on the 4 official criteria as a coaching estimate to guide practice — not an official score. AI Speaking on Ultra works the same way." },
  { q: "What payment methods work?", a: "Local cards and payment providers — the exact options appear at checkout once paid plans launch." },
  { q: "Can I switch plans?", a: "Yes. Buy the same tier again and the extra time stacks onto what's left. Switch to a different tier and a fresh period starts from your payment — time isn't prorated." },
  { q: "Do I need a card for the free plan?", a: "No. Basic needs no card — just sign up and start." },
];

const fmt = (tiyin: number) => new Intl.NumberFormat("en-US").format(Math.round(tiyin / 100));

/** Inline-алерт из ?error= (initiatePayment fail-closed): честное сообщение вместо
 *  сырого HTTP. `unavailable` — оплата не запущена (гейт paymentsLive). */
const ERROR_COPY: Record<string, string> = {
  unavailable: "Paid plans aren't live yet. Tap “Notify me” on a plan and we'll email you the moment they open.",
  provider: "Something went wrong starting checkout. Please try again.",
  plan: "That plan isn't available right now. Please pick another.",
};

export default function PricingScreen({
  current,
  price,
  ctaHref,
  speakingEnabled = false,
  paymentsLive = true,
  error,
}: {
  current: Tier;
  price: { premium: Price; ultra: Price };
  /** Guest mode (public /pricing): every CTA links here instead of starting a
   *  payment, and no plan is marked "current" — the visitor isn't logged in. */
  ctaHref?: string;
  /** SPEAKING_EVAL_MODEL ops-gate — advertise the free Speaking preview only when
   *  the feature is actually reachable (false until launch). */
  speakingEnabled?: boolean;
  /** Платёжный гейт (§12): false в production без мерчант-ключа — платный CTA
   *  прячем за waitlist, чтобы не вести в тупик оплаты. Guest-режим не затрагивает.
   *  Default true — публичная /pricing и dev рендерят обычный CTA. */
  paymentsLive?: boolean;
  /** ?error= из initiatePayment fail-closed → inline-алерт. */
  error?: string;
}) {
  const [annual, setAnnual] = useState(true);
  const CARDS = buildCards(speakingEnabled);
  const errorMsg = error ? ERROR_COPY[error] : undefined;

  return (
    <div className="pricing-wrap" style={S.wrap}>
      <style>{`.pricing-wrap{padding:28px 16px 48px}@media(min-width:768px){.pricing-wrap{padding:38px 28px 56px}}@media(max-width:430px){.pricing-togglebtn{min-height:44px}}`}</style>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={S.eyebrow}>
          <Icon name="bar-chart" size={14} /> Know your real band. Unlock Writing &amp; Speaking.
        </span>
        <h1 style={S.h1}>Pick your plan</h1>
        <p style={S.lead}>
          Practice and review free. Upgrade for full mock exams with your <i style={{ fontFamily: "var(--font-reading)" }}>real</i> band — and AI Writing feedback.
        </p>
      </div>

      {errorMsg && (
        <div role="alert" style={S.alert}>
          <Icon name="info" size={17} style={{ flex: "none", marginTop: 1 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Billing toggle */}
      <div style={{ display: "flex", justifyContent: "center", margin: "22px 0 30px" }}>
        <div style={S.toggle}>
          {([["monthly", "Monthly"], ["annual", "Annual"]] as const).map(([v, l]) => {
            const on = (v === "annual") === annual;
            return (
              <button key={v} onClick={() => setAnnual(v === "annual")} className="pricing-togglebtn" style={{ ...S.toggleBtn, background: on ? "var(--surface)" : "transparent", color: on ? "var(--text-primary)" : "var(--text-muted)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
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
          <PlanCard key={card.id} card={card} current={current} annual={annual} price={price} ctaHref={ctaHref} paymentsLive={paymentsLive} />
        ))}
      </div>

      {/* Trust line */}
      <div style={S.trust}>
        {["No auto-renew", "Local cards & payment providers", "Reading & Listening practice free"].map((t) => (
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
  ctaHref,
  paymentsLive,
}: {
  card: PlanCardMeta;
  current: Tier;
  annual: boolean;
  price: { premium: Price; ultra: Price };
  ctaHref?: string;
  paymentsLive: boolean;
}) {
  const pop = !!card.popular;
  const guest = !!ctaHref;
  const isCurrent = !guest && current === card.id;
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
            <span style={S.priceUnit}>no card needed</span>
          </>
        )}
      </div>

      {guest ? (
        // Public /pricing: not logged in — send every CTA to sign-up, no payment.
        <Button href={ctaHref} size="lg" fullWidth variant={pop ? "primary" : "secondary"} trailingIcon="arrow-right">
          {card.id === "basic" ? "Start free" : card.cta}
        </Button>
      ) : paid && !isCurrent ? (
        paymentsLive ? (
          <form action={initiatePayment}>
            <input type="hidden" name="tier" value={card.id} />
            <input type="hidden" name="months" value={annual ? 12 : 1} />
            <input type="hidden" name="provider" value="payme" />
            <Button type="submit" size="lg" fullWidth variant={pop ? "primary" : "secondary"} trailingIcon="arrow-right">
              {card.cta}
            </Button>
          </form>
        ) : (
          // Оплата ещё не запущена (§12): вместо тупика — сбор интереса (waitlist).
          <WaitlistCta tier={card.id} months={annual ? 12 : 1} pop={pop} />
        )
      ) : (
        <Button size="lg" fullWidth variant="secondary" disabled>
          {isCurrent ? "Current plan" : card.id === "basic" ? "Free" : card.cta}
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

/**
 * Waitlist-CTA (§12): пока оплата не запущена, вместо покупки собираем интерес.
 * Оптимистично переходим в "joined" сразу по клику — событие payment_waitlist
 * best-effort (аналитика не критична), ошибку глушим и состояние не откатываем:
 * повторно давить кнопку смысла нет, а «сорвавшийся» лог не должен пугать юзера.
 */
function WaitlistCta({ tier, months, pop }: { tier: CardId; months: number; pop: boolean }) {
  const [joined, setJoined] = useState(false);
  return (
    <>
      <Button
        size="lg"
        fullWidth
        variant={joined ? "secondary" : pop ? "primary" : "secondary"}
        disabled={joined}
        icon={joined ? "circle-check" : "bell"}
        onClick={() => {
          if (joined) return;
          setJoined(true);
          void joinPaymentWaitlist({ tier, months }).catch(() => {});
        }}
      >
        {joined ? "You're on the list" : "Notify me when paid plans launch"}
      </Button>
      <p style={S.waitNote}>Paid plans aren't live yet — free plan works in full.</p>
    </>
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
  wrap: {},
  eyebrow: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)", background: "var(--brand-subtle)", padding: "5px 14px", borderRadius: "var(--radius-full)", marginBottom: 14 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 8px" },
  lead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-muted)", margin: 0 },
  alert: { display: "flex", alignItems: "flex-start", gap: 9, maxWidth: 620, margin: "16px auto 0", padding: "11px 15px", background: "var(--brand-subtle)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.45, textAlign: "left" },
  waitNote: { margin: "9px 0 0", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.4 },

  toggle: { display: "inline-flex", alignItems: "center", gap: 4, padding: 4, background: "var(--surface-inset)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-full)" },
  toggleBtn: { display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 18px", border: "none", borderRadius: "var(--radius-full)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer" },
  saveTag: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, color: "var(--success-text)", background: "var(--success-subtle)", padding: "2px 7px", borderRadius: "var(--radius-full)" },

  plans: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, alignItems: "start", maxWidth: 920, margin: "0 auto" },
  ribbon: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--brand)", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", padding: "5px 12px", borderRadius: "var(--radius-full)", boxShadow: "0 3px 0 0 var(--brand-edge)" },
  planName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)" },
  tagline: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", minHeight: 38, lineHeight: 1.4 },
  price: { fontFamily: "var(--font-ui)", fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em" },
  priceUnit: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },

  trust: { display: "flex", justifyContent: "center", gap: 22, flexWrap: "wrap", margin: "30px 0 38px", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  faqHead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)", textAlign: "center", margin: "0 0 12px" },
};
