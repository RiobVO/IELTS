import { eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, badge, question } from "@/db/schema";
import { getProfile, getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { effectiveTier, hasFullReview, type Tier } from "@/lib/tiers";
import { qtypeLabel } from "@/lib/labels";
import { AppShell } from "../../../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import BadgeUnlock from "./BadgeUnlock";
import { ShareResult } from "./ShareResult";

export const dynamic = "force-dynamic";

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

  // Review depth is tier-gated (§4.8): Basic sees score + percent only; the
  // per-type breakdown, explanations and evidence are Premium+. effectiveTier
  // downgrades an expired premium so a stale tier can't unlock the full review.
  const profile = await getProfile();
  const fullReview = profile
    ? hasFullReview(
        effectiveTier(profile as { tier: Tier; premium_until: string | Date | null }),
      )
    : false;

  // answer_key read server-side (owner role) — explanations/evidence revealed
  // only AFTER submit (BRIEF §4.2), and only to the attempt's owner.
  const rows = await db
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
    .orderBy(question.number);

  const answers = (att.answers ?? {}) as Record<string, string | string[]>;
  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));
  // NB: разбор пересчитывается по ТЕКУЩЕМУ answer_key, а не по баллу, сохранённому
  // в attempt на момент сдачи. Если ключ правят после сдачи, показанный здесь
  // raw_score/percent может разойтись с att.raw_score (по которому начислены
  // rating/XP). Полный re-grade (version bump + пересчёт затронутых attempt +
  // пометка «балл уточнён») отложен — BRIEF §11 / CLAUDE.md. Деструктивный
  // ре-импорт при наличии попыток уже заблокирован (RegradeRequiredError).
  const result = grade(keys, answers);
  const meta = new Map(rows.map((r) => [r.number, r]));

  const perType = Object.entries(result.perType).sort(
    (a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total,
  );

  // Badges this submit just unlocked — passed as codes on the redirect from the
  // submit action (the exact set, deduped server-side via the award insert's
  // RETURNING). Absent on revisits, so the celebration shows exactly once.
  const unlockedCodes = (unlocked ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const unlockedBadges =
    unlockedCodes.length > 0
      ? await db
          .select({
            id: badge.id,
            code: badge.code,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
          })
          .from(badge)
          .where(inArray(badge.code, unlockedCodes))
      : [];

  const banded = att.bandScore != null;

  // Shareable one-liner for the Telegram viral loop (W1-5). The share link
  // carries the user's referral code, so a friend who joins ties into 2C.
  const shareScore = banded ? `band ${att.bandScore}` : `${result.percent}%`;
  const weakestType = perType.length ? qtypeLabel(perType[0][0]) : null;
  const shareHeadline = `I scored ${shareScore} on bando${weakestType ? ` — weakest type: ${weakestType}` : ""}. Train your IELTS Reading & Listening:`;

  return (
    <AppShell active="reading">
      <div style={S.wrap}>
        <div style={S.backRow}>
          <Button variant="ghost" size="sm" icon="arrow-left" href="/app/reading">
            Catalog
          </Button>
        </div>

        {/* Score header — band present but secondary */}
        <div style={S.scoreCard}>
          <div>
            <div style={S.scoreLabel}>{banded ? "Band score" : "Result"}</div>
            <div style={S.scoreBig}>
              {banded ? att.bandScore : <>{result.percent}<span style={S.pctSign}>%</span></>}
            </div>
          </div>
          <div style={S.scoreMeta}>
            <div style={S.scoreFrac}>
              {result.rawScore}
              <span style={S.scoreFracTot}>/{result.total}</span>
            </div>
            <div style={S.scoreSub}>
              {result.percent}% correct{banded ? "" : " · single passage"}
            </div>
          </div>
        </div>

        {unlockedBadges.length > 0 && (
          <div style={S.section}>
            <BadgeUnlock badges={unlockedBadges} />
          </div>
        )}

        {/* THE HERO — per-type breakdown. Shown to EVERYONE: it's the "aha" of
            the whole offer, and §4.8 gives Basic the per-type analytics. Premium
            adds depth (answers + why + evidence) below, not the breakdown itself. */}
        <section style={S.section}>
          <h2 style={S.h2}>Where you lose points</h2>
          <p style={S.sub}>Worst type first.</p>
          <div style={S.breakdownCard}>
            {perType.map(([type, s], i) => {
              const pct = Math.round((s.correct / s.total) * 100);
              const tone =
                pct >= 70
                  ? { bar: "var(--success)", text: "var(--success-text)" }
                  : pct >= 40
                    ? { bar: "var(--warn)", text: "var(--warn-text)" }
                    : { bar: "var(--error)", text: "var(--error-text)" };
              return (
                <div key={type} style={S.brRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={S.brHead}>
                      <span style={S.brName}>{qtypeLabel(type)}</span>
                      {i === 0 && <span style={S.weakest}>WEAKEST</span>}
                    </div>
                    <div style={S.brTrack}>
                      <div style={{ ...S.brFill, width: `${pct}%`, background: tone.bar }} />
                    </div>
                  </div>
                  <span style={{ ...S.brScore, color: tone.text }}>
                    {s.correct}/{s.total}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-question review. Everyone sees right/wrong per question (the lesson
            — turns the result into a return, not a paywall). The correct answer,
            the explanation and the text evidence are revealed ONLY for Premium
            (`fullReview`): when false those props are simply not rendered, so the
            answer_key never reaches a Basic user's HTML. */}
        <section style={S.section}>
          <div style={S.reviewHead}>
            <h2 style={S.h2b}>{fullReview ? "Answer review" : "What you missed"}</h2>
            {!fullReview && <Badge tone="brand">Answers on Premium</Badge>}
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

        {/* Basic: weak types + right/wrong are shown above; Premium reveals the
            correct answers, the why, and the text evidence. */}
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
  /** Premium: reveal the correct answer, explanation and evidence. When false
   *  they are NOT rendered, so the answer_key never reaches a Basic user. */
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
      {reveal && explanation && <div style={S.expl}>{explanation}</div>}
      {reveal && evidence && (
        <div style={S.evidence}>
          <Icon name="book-open" size={15} style={{ color: "var(--reading-muted)", marginTop: 2, flex: "none" }} />
          <span>“{evidence}”</span>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 780, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column", gap: 4 },
  backRow: { display: "flex", alignItems: "center", marginBottom: 4 },

  scoreCard: {
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
    padding: "18px 20px",
    background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))",
    border: "2px solid var(--brand-border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-solid)",
  },
  scoreLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  scoreBig: { fontFamily: "var(--font-ui)", fontSize: "var(--text-5xl)", fontWeight: 900, letterSpacing: "var(--tracking-tighter)", color: "var(--brand)", lineHeight: 1 },
  pctSign: { fontSize: "var(--text-2xl)", fontWeight: 800 },
  scoreMeta: { paddingBottom: 8 },
  scoreFrac: { fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", color: "var(--text-secondary)" },
  scoreFracTot: { color: "var(--text-muted)" },
  scoreSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },

  section: { marginTop: 18 },
  h2: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "0 0 4px", color: "var(--text-primary)" },
  h2b: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, margin: 0, color: "var(--text-primary)" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 14px" },

  breakdownCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: 2 },
  brRow: { display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-3)" },
  brHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 7 },
  brName: { fontFamily: "var(--font-reading)", fontSize: "var(--text-base)", fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  weakest: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--error-text)", background: "var(--error-subtle)", padding: "2px 7px", borderRadius: "var(--radius-full)", letterSpacing: "var(--tracking-wide)", flex: "none" },
  brTrack: { height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  brFill: { height: "100%", borderRadius: "var(--radius-full)" },
  brScore: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 38, textAlign: "right" },

  reviewHead: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" },
  rev: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" },
  revHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  revMark: { width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" },
  revNum: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  revType: { fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  revLines: { display: "flex", gap: 18, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", marginBottom: 10 },
  revLabel: { color: "var(--text-muted)" },
  expl: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" },
  evidence: { marginTop: 10, display: "flex", gap: 8, fontFamily: "var(--font-reading)", fontSize: "var(--text-sm)", color: "var(--reading-text)", background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-md)", padding: "10px 12px" },

  upsell: { marginTop: 18, border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", borderRadius: "var(--radius-xl)", padding: "1.4rem 1.3rem", textAlign: "center" },
  upsellTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text-link)" },
  upsellText: { fontFamily: "var(--font-ui)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: ".5rem auto 1rem", maxWidth: 440, lineHeight: 1.5 },

  footer: { marginTop: 24, display: "flex", gap: 10 },
};
