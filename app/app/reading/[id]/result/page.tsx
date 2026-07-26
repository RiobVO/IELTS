import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { answerKey, attempt, badge, contentItem, question } from "@/db/schema";
import { getProfile, getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { effectiveTier, hasFullReview, type Tier } from "@/lib/tiers";
import { categoryLabel, qtypeLabel } from "@/lib/labels";
import { AppShell } from "../../../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import BadgeUnlock from "./BadgeUnlock";
import { ShareResult } from "./ShareResult";
import { AnimatedDonut, CountUp, RevealBars, FadeUp } from "./reveal";

export const dynamic = "force-dynamic";

const barColor = (pct: number) =>
  pct < 45 ? "var(--error)" : pct < 70 ? "var(--warn)" : "var(--success)";
const barText = (pct: number) =>
  pct < 45 ? "var(--error-text)" : pct < 70 ? "var(--warn-text)" : "var(--success-text)";

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; unlocked?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/auth");
  const { id } = await params;
  const { a: attemptId, unlocked } = await searchParams;
  if (!attemptId) notFound();

  const [att] = await db.select().from(attempt).where(eq(attempt.id, attemptId));
  // Ownership check — a user can only see their own attempt's review.
  if (!att || att.userId !== user.id || att.contentItemId !== id) notFound();

  // Review depth seam (§4.8): `hasFullReview` follows the launch flag REVIEW_OPEN
  // — currently OPEN, so the review is free for everyone. The Premium gate is
  // intact (flip REVIEW_OPEN to re-gate). effectiveTier still downgrades an
  // expired premium so the gated path stays correct when the flag is closed.
  // answer_key is read server-side (owner role) and revealed only AFTER submit,
  // only to the attempt's owner, and only when `fullReview` is true.
  const [profile, rows, ci, pctRow, prevRows] = await Promise.all([
    getProfile(),
    db
      .select({
        number: question.number,
        qtype: question.qtype,
        promptHtml: question.promptHtml,
        mode: answerKey.mode,
        accept: answerKey.accept,
        explanation: answerKey.explanation,
        evidence: answerKey.evidence,
      })
      .from(question)
      .innerJoin(answerKey, eq(answerKey.questionId, question.id))
      .where(eq(question.contentItemId, id))
      .orderBy(question.number),
    db
      .select({ title: contentItem.title, category: contentItem.category })
      .from(contentItem)
      .where(eq(contentItem.id, id))
      .limit(1),
    // Percentile vs other students: count of submitted attempts on this test and
    // how many scored strictly below this one (shown only when there are enough).
    att.rawScore != null
      ? db
          .select({
            total: sql<number>`count(*)::int`,
            below: sql<number>`count(*) filter (where ${attempt.rawScore} < ${att.rawScore})::int`,
          })
          .from(attempt)
          .where(and(eq(attempt.contentItemId, id), eq(attempt.status, "submitted")))
      : Promise.resolve([{ total: 0, below: 0 }]),
    // Previous submitted attempt on this test (for the "since last test" delta).
    att.submittedAt
      ? db
          .select({ rawScore: attempt.rawScore, bandScore: attempt.bandScore })
          .from(attempt)
          .where(
            and(
              eq(attempt.userId, user.id),
              eq(attempt.contentItemId, id),
              eq(attempt.status, "submitted"),
              lt(attempt.submittedAt, att.submittedAt),
            ),
          )
          .orderBy(desc(attempt.submittedAt))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const fullReview = profile
    ? hasFullReview(
        effectiveTier(profile as { tier: Tier; premium_until: string | Date | null }),
      )
    : false;

  const answers = (att.answers ?? {}) as Record<string, string | string[]>;
  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));
  // NB: разбор пересчитывается по ТЕКУЩЕМУ answer_key, а не по баллу, сохранённому
  // в attempt на момент сдачи (полный re-grade отложен — BRIEF §11; деструктивный
  // ре-импорт при наличии попыток уже заблокирован RegradeRequiredError).
  const result = grade(keys, answers);
  const meta = new Map(rows.map((r) => [r.number, r]));

  const perType = Object.entries(result.perType).sort(
    (a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total,
  );
  const weakest = perType.length ? perType[0] : null;

  const banded = att.bandScore != null;
  const correctPct = result.total > 0 ? result.rawScore / result.total : 0;
  const title = ci[0]?.title ?? "Your report";
  const category = ci[0]?.category ?? null;

  // Honest key metrics — only those backed by real data are rendered. Colour is
  // semantic: green ONLY when the number is genuinely good; neutral otherwise.
  // A 0% result must never read as a win (no green "Top 100%", no green "+0%").
  const NEUTRAL = "var(--text-secondary)";
  const metrics: { value: string; label: string; color: string }[] = [];
  if (att.timeUsedSeconds != null) {
    metrics.push({ value: fmtDuration(att.timeUsedSeconds), label: "Time taken", color: "var(--sky-500)" });
    if (result.total > 0) {
      // Sub-second averages round to "0s", which reads as broken — floor to "<1s".
      const avg = att.timeUsedSeconds / result.total;
      metrics.push({ value: avg < 1 ? "<1s" : fmtDuration(Math.round(avg)), label: "Avg / question", color: "var(--brand)" });
    }
  }
  const pct = pctRow[0] ?? { total: 0, below: 0 };
  if (pct.total >= 5 && att.rawScore != null) {
    // Percentile rank = share of attempts scored strictly below this one. Higher
    // is better and intuitive ("you beat X%"), unlike "Top X%" where 100% is the
    // WORST result. Green only once you're genuinely ahead of the field.
    const ahead = Math.round((pct.below / pct.total) * 100);
    metrics.push({ value: `Ahead of ${ahead}%`, label: "of other students", color: ahead >= 50 ? "var(--success-text)" : NEUTRAL });
  }
  const prev = prevRows[0];
  if (prev) {
    if (banded && prev.bandScore != null) {
      const d = Number(att.bandScore) - Number(prev.bandScore);
      metrics.push({ value: `${d > 0 ? "+" : ""}${d.toFixed(1)}`, label: "Band since last", color: d > 0 ? "var(--success-text)" : d < 0 ? "var(--error-text)" : NEUTRAL });
    } else if (prev.rawScore != null && result.total > 0) {
      const dp = result.percent - Math.round((prev.rawScore / result.total) * 100);
      metrics.push({ value: `${dp > 0 ? "+" : ""}${dp}%`, label: "Since last test", color: dp > 0 ? "var(--success-text)" : dp < 0 ? "var(--error-text)" : NEUTRAL });
    }
  }

  // Badges this submit just unlocked — codes passed on the submit redirect.
  const unlockedCodes = (unlocked ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const unlockedBadges =
    unlockedCodes.length > 0
      ? await db
          .select({ id: badge.id, code: badge.code, name: badge.name, description: badge.description, icon: badge.icon })
          .from(badge)
          .where(inArray(badge.code, unlockedCodes))
      : [];

  // Shareable one-liner for the Telegram viral loop (W1-5).
  const shareScore = banded ? `band ${att.bandScore}` : `${result.percent}%`;
  const weakestType = weakest ? qtypeLabel(weakest[0]) : null;
  const shareHeadline = `I scored ${shareScore} on bando${weakestType ? ` — weakest type: ${weakestType}` : ""}. Train your IELTS Reading & Listening:`;

  return (
    <AppShell active="reading">
      <style>{RESULT_CSS}</style>
      <div style={S.wrap}>
        <div style={S.backRow}>
          <Button variant="ghost" size="sm" icon="arrow-left" href="/app/reading">
            Catalog
          </Button>
        </div>

        {/* Report header */}
        <div style={S.repHead}>
          <div style={{ minWidth: 0 }}>
            <h1 style={S.h1}>Your report</h1>
            <div style={S.repSub}>
              {title}
              {category ? ` · ${categoryLabel(category)}` : ""} · {result.total} questions
            </div>
          </div>
          {fullReview && (
            <Badge tone="success">
              <Icon name="book-open" size={12} /> Full report free
            </Badge>
          )}
        </div>

        {unlockedBadges.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <BadgeUnlock badges={unlockedBadges} />
          </div>
        )}

        {/* Top metrics — donut + band + key metrics */}
        <div className="res-metrics" style={S.metricsCard}>
          <div style={S.donutBlock}>
            <AnimatedDonut pct={correctPct} />
            <div>
              <div style={S.metricEyebrow}>{banded ? "Band score" : "Score"}</div>
              <div style={S.bandBig}>
                <CountUp
                  value={banded ? Number(att.bandScore) : result.percent}
                  decimals={banded ? 1 : 0}
                  suffix={banded ? "" : "%"}
                />
              </div>
              <div style={S.rawLine}>
                {result.rawScore}/{result.total} correct
              </div>
            </div>
          </div>
          {metrics.length > 0 && (
            <div className="res-mgrid" style={S.metricsGrid}>
              {metrics.map((m) => (
                <div key={m.label} style={S.metricTile}>
                  <div style={{ ...S.metricValue, color: m.color }}>{m.value}</div>
                  <div style={S.metricLabel}>{m.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Accuracy by question type */}
        {perType.length > 0 && (
          <div className="res-card" style={S.card}>
            <div style={S.cardTitle}>Accuracy by question type</div>
            <RevealBars style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {perType.map(([type, s], i) => {
                const p = Math.round((s.correct / s.total) * 100);
                return (
                  <div key={type} className="res-acc" style={S.accRow}>
                    <div className="res-accname" style={S.accName}>
                      <span style={S.accLabel}>{qtypeLabel(type)}</span>
                      {i === 0 && <span data-weakest className="res-weakest" style={S.weakest}>WEAKEST</span>}
                    </div>
                    <div style={S.accTrack}>
                      <div data-grow style={{ height: "100%", width: `${Math.max(p, 2)}%`, borderRadius: "var(--radius-full)", background: barColor(p) }} />
                    </div>
                    <span style={{ ...S.accScore, color: barText(p) }}>
                      {s.correct}/{s.total}
                    </span>
                    <Link href={`/app/reading?q_type=${encodeURIComponent(type)}`} className="res-practise" style={S.practise}>
                      <span className="res-practise-label">Practise </span>→
                    </Link>
                  </div>
                );
              })}
            </RevealBars>
          </div>
        )}

        {/* Recommendation */}
        {weakest && (
          <FadeUp delayMs={620}>
            <div style={S.recoCard}>
              <span style={S.recoIcon}>
                <Icon name="target" size={20} strokeWidth={2.3} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ color: "var(--text-primary)" }}>Recommended:</b> start with{" "}
                {qtypeLabel(weakest[0])} — your weakest type and the fastest band gain.
              </div>
              <Button href={`/app/reading?q_type=${encodeURIComponent(weakest[0])}`} trailingIcon="arrow-right" style={{ flex: "none" }}>
                Start
              </Button>
            </div>
          </FadeUp>
        )}

        {/* Answer key. Everyone sees right/wrong per question. The correct answer,
            explanation and text evidence are revealed only when `fullReview` is
            true — currently free for all (REVIEW_OPEN). When the flag is closed,
            those props aren't rendered, so the answer_key never reaches the HTML. */}
        <section style={{ marginTop: 18 }}>
          <div style={S.reviewHead}>
            <h2 style={S.h2}>{fullReview ? "Full answer key" : "What you missed"}</h2>
            {fullReview ? (
              <Badge tone="success">
                <Icon name="book-open" size={12} /> Free
              </Badge>
            ) : (
              <Badge tone="brand">Answers on Premium</Badge>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {result.perQuestion.map((q) => {
              const m = meta.get(q.number)!;
              const given = Array.isArray(q.given) ? q.given.join(", ") : q.given;
              const correctAns = (m.accept as string[]).join(" / ");
              const ev = m.evidence as { para: string; snippet: string } | null;
              return (
                <ReviewCard
                  key={q.number}
                  number={q.number}
                  qtype={q.qtype}
                  correct={q.correct}
                  given={given && given !== "" ? given : "—"}
                  answer={correctAns}
                  explanation={m.explanation}
                  evidence={ev?.snippet ?? null}
                  reveal={fullReview}
                />
              );
            })}
          </div>
        </section>

        {/* Gated path (flag closed): weak types + right/wrong are free above;
            Premium reveals the answers, the why, and the evidence. */}
        {!fullReview && (
          <div style={S.upsell}>
            <div style={S.upsellTitle}>See the answers and why</div>
            <p style={S.upsellText}>
              You can see your weakest types and which questions you missed. Premium reveals the
              correct answers, the explanation behind each, and the exact text evidence.
            </p>
            <Button href="/app/upgrade" trailingIcon="arrow-right">
              Go Premium
            </Button>
          </div>
        )}

        {profile?.referral_code && (
          <div style={{ marginTop: 18 }}>
            <ShareResult refCode={profile.referral_code} headline={shareHeadline} />
          </div>
        )}

        <div style={S.footer}>
          <Button variant="secondary" fullWidth href="/app/reading">
            Back to catalog
          </Button>
          <Button fullWidth trailingIcon="arrow-right" href={`/app/reading/${id}`}>
            Try again
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function ReviewCard({
  number,
  qtype,
  correct,
  given,
  answer,
  explanation,
  evidence,
  reveal,
}: {
  number: number;
  qtype: string;
  correct: boolean;
  given: string;
  answer: string;
  explanation: string | null;
  evidence: string | null;
  /** Reveal the correct answer, explanation and evidence. When false they are
   *  NOT rendered, so the answer_key never reaches a gated user's HTML. */
  reveal: boolean;
}) {
  return (
    <div style={S.rev}>
      <div style={S.revHead}>
        <span style={{ ...S.revMark, background: correct ? "var(--success-subtle)" : "var(--error-subtle)", color: correct ? "var(--success-text)" : "var(--error-text)" }}>
          <Icon name={correct ? "check" : "x"} size={14} />
        </span>
        <span style={S.revNum}>Q{number}</span>
        <span style={S.revType}>{qtypeLabel(qtype)}</span>
      </div>
      <div style={S.revLines}>
        <div>
          <span style={S.revLabel}>You </span>
          <b style={{ color: correct ? "var(--success-text)" : "var(--error-text)" }}>{given}</b>
        </div>
        {!correct && reveal && (
          <div>
            <span style={S.revLabel}>Answer </span>
            <b style={{ color: "var(--text-primary)" }}>{answer}</b>
          </div>
        )}
      </div>
      {reveal && explanation && (
        <div style={S.expl}>
          <Icon name="lightbulb" size={14} style={{ color: "var(--warn-text)", marginTop: 2, flex: "none" }} />
          <span>{explanation}</span>
        </div>
      )}
      {reveal && evidence && (
        <div style={S.evidence}>
          <Icon name="book-open" size={15} style={{ color: "var(--reading-muted)", marginTop: 2, flex: "none" }} />
          <span>“{evidence}”</span>
        </div>
      )}
    </div>
  );
}

// Адаптив result. База = мобильный (метрики стек, узкая accName, practise → стрелка);
// ≥560px = десктоп. Переключаемые grid/border/width — в классах, не inline.
const RESULT_CSS = `
.res-card{padding:18px 16px}
.res-metrics{grid-template-columns:1fr;gap:18px;padding:18px 16px}
.res-mgrid{border-top:1px solid var(--border-subtle);padding-top:16px}
.res-acc{gap:10px}
.res-accname{width:96px}
.res-practise-label{display:none}
.res-weakest{display:none}
@media (min-width:560px){
  .res-card{padding:20px 24px}
  .res-metrics{grid-template-columns:auto 1fr;gap:22px;padding:22px}
  .res-mgrid{border-top:none;padding-top:0;border-left:1px solid var(--border-subtle);padding-left:22px}
  .res-acc{gap:14px}
  .res-accname{width:200px}
  .res-practise-label{display:inline}
  .res-weakest{display:inline-flex}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column" },
  backRow: { display: "flex", alignItems: "center", marginBottom: 4 },

  repHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  repSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  metricsCard: { display: "grid", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", alignItems: "center", marginBottom: 14 },
  donutBlock: { display: "flex", alignItems: "center", gap: 20 },
  metricEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  bandBig: { fontFamily: "var(--font-mono)", fontSize: 46, fontWeight: 600, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.02em" },
  rawLine: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 },
  metricsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  metricTile: { background: "var(--surface-inset)", borderRadius: 12, padding: "12px 14px" },
  metricValue: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", fontWeight: 600 },
  metricLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", fontWeight: 600, marginTop: 2 },

  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", marginBottom: 14 },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", marginBottom: 14 },
  accRow: { display: "flex", alignItems: "center" },
  // Колонка имени держит фикс-ширину (бары всех строк выровнены). Подпись —
  // сжимаемый ellipsis-span (minWidth:0), бейдж WEAKEST — flex:none, поэтому
  // бейдж никогда не режется, а сокращается подпись.
  accName: { flex: "none", display: "flex", alignItems: "center", gap: 7, minWidth: 0, overflow: "hidden", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" },
  accLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  weakest: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--error-text)", background: "var(--error-subtle)", padding: "2px 6px", borderRadius: "var(--radius-full)", flex: "none" },
  accTrack: { flex: 1, height: 9, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  accScore: { width: 44, flex: "none", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600 },
  practise: { flex: "none", textAlign: "right", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" },

  recoCard: { display: "flex", alignItems: "center", gap: 14, border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", borderRadius: "var(--radius-xl)", padding: "16px 20px", boxShadow: "var(--shadow-solid)", marginBottom: 14, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  recoIcon: { flex: "none", color: "var(--brand)" },

  reviewHead: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" },
  h2: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, margin: 0, color: "var(--text-primary)" },
  rev: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" },
  revHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  revMark: { width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" },
  revNum: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  revType: { fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  revLines: { display: "flex", gap: 18, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", marginBottom: 10 },
  revLabel: { color: "var(--text-muted)" },
  expl: { display: "flex", gap: 8, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" },
  evidence: { marginTop: 10, display: "flex", gap: 8, fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-md)", padding: "10px 12px" },

  upsell: { marginTop: 18, border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", borderRadius: "var(--radius-xl)", padding: "1.4rem 1.3rem", textAlign: "center" },
  upsellTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text-link)" },
  upsellText: { fontFamily: "var(--font-ui)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: ".5rem auto 1rem", maxWidth: 440, lineHeight: 1.5 },

  footer: { marginTop: 24, display: "flex", gap: 10 },
};
