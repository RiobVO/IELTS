import { and, asc, desc, eq, exists, isNotNull, lt, ne, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, contentItem, question } from "@/db/schema";
import { getActiveBadges } from "@/lib/content/badges";
import { getProfile, getUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { effectiveTier, hasFullReview, type Tier } from "@/lib/tiers";
import { categoryLabel, qtypeLabel } from "@/lib/labels";
import { AppShell } from "../../../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import BadgeUnlock from "./BadgeUnlock";
import { ShareResult } from "./ShareResult";
import { AnimatedDonut, CountUp, FadeUp } from "./reveal";
import { AccuracyByType, AnswerKeyFilter, type AccRow, type AKItem, type AKType } from "./InsightReport";

export const dynamic = "force-dynamic";

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

  // otherFirsts: ПЕРВАЯ submitted-попытка каждого ДРУГОГО юзера на этот тест
  // (ретейки не накручивают percentile, сам пользователь исключён — тот же
  // first-attempt-per-user анти-фарм, что у лидерборда; индекс
  // attempt_user_content_submitted_idx, migration 0017). isNotNull(raw_score) —
  // чтобы редкая legacy-строка без балла не раздувала знаменатель.
  const otherFirsts = db
    .selectDistinctOn([attempt.userId], { rawScore: attempt.rawScore })
    .from(attempt)
    .where(
      and(
        eq(attempt.contentItemId, id),
        eq(attempt.status, "submitted"),
        ne(attempt.userId, user.id),
        isNotNull(attempt.rawScore),
      ),
    )
    .orderBy(attempt.userId, asc(attempt.submittedAt))
    .as("other_firsts");

  // Один параллельный слой. Раньше att-read лидировал отдельным хопом, потому что
  // pctRow/prevRows зависели от его JS-значений; теперь они берут att.raw_score /
  // att.submitted_at коррелированными подзапросами по attemptId, поэтому весь набор
  // читается одним round-trip. Проверка владения — JS-гард ПОСЛЕ (notFound для UX);
  // answer_key в `rows` дополнительно заперт SQL-EXISTS: строки вернутся ТОЛЬКО для
  // attempt этого юзера — чужой/несуществующий id → пустой ключ, БД его не читает,
  // так что инвариант «answer_key только владельцу» держится на уровне SQL.
  // Review depth seam (§4.8): `hasFullReview` follows the launch flag REVIEW_OPEN —
  // currently OPEN; effectiveTier downgrades an expired premium when the flag closes.
  const [attRows, profile, rows, ci, pctRow, prevRows] = await Promise.all([
    // Явная проекция: только используемые ниже колонки. `answers` — для re-grade;
    // тяжёлый per_type_breakdown НЕ нужен (разбор пересчитывается через grade()).
    db
      .select({
        userId: attempt.userId,
        contentItemId: attempt.contentItemId,
        answers: attempt.answers,
        submittedAt: attempt.submittedAt,
        timeUsedSeconds: attempt.timeUsedSeconds,
        rawScore: attempt.rawScore,
        bandScore: attempt.bandScore,
      })
      .from(attempt)
      .where(eq(attempt.id, attemptId)),
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
      // EXISTS-гард: answer_key раскрывается, только если этот attempt принадлежит
      // юзеру и относится к этому тесту — иначе ни одной строки (БД не отдаёт ключ
      // для чужой/несуществующей попытки, до и независимо от JS-проверки владения).
      .where(
        and(
          eq(question.contentItemId, id),
          exists(
            db
              .select({ one: sql`1` })
              .from(attempt)
              .where(
                and(
                  eq(attempt.id, attemptId),
                  eq(attempt.userId, user.id),
                  eq(attempt.contentItemId, id),
                ),
              ),
          ),
        ),
      )
      .orderBy(question.number),
    db
      .select({
        title: contentItem.title,
        category: contentItem.category,
        section: contentItem.section,
        durationSeconds: contentItem.durationSeconds,
        // Только флаг наличия раннера для маршрутизации «Try again» — НЕ сам
        // runner_html (~200КБ); как в каталоге (getPublishedTests).
        hasRunner: sql<boolean>`${contentItem.runnerHtml} IS NOT NULL`,
      })
      .from(contentItem)
      .where(eq(contentItem.id, id))
      .limit(1),
    // Percentile vs other students: сколько ДРУГИХ набрали строго меньше этой
    // попытки. att.raw_score берётся коррелированным подзапросом по attemptId
    // (NULL → сравнение false → below=0; JS-гард ниже прячет метрику для legacy).
    db
      .select({
        total: sql<number>`count(*)::int`,
        below: sql<number>`count(*) filter (where ${otherFirsts.rawScore} < (select sub.raw_score from ${attempt} sub where sub.id = ${attemptId}))::int`,
      })
      .from(otherFirsts),
    // Предыдущая submitted-попытка на этом тесте (дельта «since last test»). Граница
    // по времени = att.submitted_at коррелированным подзапросом по attemptId.
    db
      .select({ rawScore: attempt.rawScore, bandScore: attempt.bandScore })
      .from(attempt)
      .where(
        and(
          eq(attempt.userId, user.id),
          eq(attempt.contentItemId, id),
          eq(attempt.status, "submitted"),
          lt(
            attempt.submittedAt,
            sql`(select sub.submitted_at from ${attempt} sub where sub.id = ${attemptId})`,
          ),
        ),
      )
      .orderBy(desc(attempt.submittedAt))
      .limit(1),
    // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
    getHeaderData(),
  ]);

  const att = attRows[0];
  // Ownership — пользователь видит разбор только своей попытки на этот тест.
  if (!att || att.userId !== user.id || att.contentItemId !== id) notFound();

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
  // Result-роут общий для обеих секций (reading/listening). Drill- и catalog-ссылки
  // должны вести в каталог ЭТОЙ секции — иначе после Listening-теста «Drill»/«Back to
  // catalog» уходили в Reading-фильтр, где listening-типов нет (AUDIT P2).
  const section = ci[0]?.section === "listening" ? "listening" : "reading";
  const catalogBase = `/app/${section}`;
  // «Try again» повторяет маршрутизацию каталога: тесты с очищенным runner_html идут
  // в iframe-обёртку (/app/exam), legacy без раннера — в React-раннер (/app/reading).
  const retryHref = ci[0]?.hasRunner ? `/app/exam/${id}` : `/app/reading/${id}`;

  // Honest key metrics — only those backed by real data are rendered. Colour is
  // semantic: green ONLY when the number is genuinely good; neutral otherwise.
  // A 0% result must never read as a win (no green "Top 100%", no green "+0%").
  const NEUTRAL = "var(--text-secondary)";
  const metrics: { value: string; label: string; color: string }[] = [];
  // Server stamps time as (submit − start) with no active-time cap (§4.6), so an
  // attempt left open and submitted days later yields absurd values ("3443m").
  // Anything far past the test's allotted time is unreliable, not real reading
  // time — omit it rather than display garbage. (A cap at submit-write is the
  // separate root follow-up; this guards every legacy row already in the DB.)
  const allottedSec = ci[0]?.durationSeconds ?? 3600;
  const timeReliable = att.timeUsedSeconds != null && att.timeUsedSeconds <= allottedSec * 3;
  if (timeReliable) {
    metrics.push({ value: fmtDuration(att.timeUsedSeconds!), label: "Time taken", color: "var(--sky-500)" });
    if (result.total > 0) {
      // Sub-second averages round to "0s", which reads as broken — floor to "<1s".
      const avg = att.timeUsedSeconds! / result.total;
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
  // Фильтруем кэш PUBLIC-таблицы badge в памяти (тег `badge`), без сырого
  // per-request запроса; гард по длине сохраняет нулевую стоимость без анлоков.
  const unlockedCodes = (unlocked ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const unlockedBadges =
    unlockedCodes.length > 0
      ? (await getActiveBadges())
          .filter((b) => unlockedCodes.includes(b.code))
          .map((b) => ({ id: b.id, code: b.code, name: b.name, description: b.description, icon: b.icon }))
      : [];

  // Shareable one-liner for the Telegram viral loop (W1-5).
  const shareScore = banded ? `band ${att.bandScore}` : `${result.percent}%`;
  const weakestType = weakest ? qtypeLabel(weakest[0]) : null;
  const shareHeadline = `I scored ${shareScore} on bando${weakestType ? ` — weakest type: ${weakestType}` : ""}. Train your IELTS Reading & Listening:`;

  // Variant A — interactive insight data, built from the already-loaded grade
  // result (no extra queries, perf-safe). The answer_key fields are attached
  // ONLY when fullReview, so a gated user's HTML never carries them.
  const accRows: AccRow[] = perType.map(([type, s], i) => ({
    type,
    label: qtypeLabel(type),
    correct: s.correct,
    total: s.total,
    weak: i === 0,
    missed: result.perQuestion.filter((q) => q.qtype === type && !q.correct).map((q) => q.number),
    got: result.perQuestion.filter((q) => q.qtype === type && q.correct).map((q) => q.number),
    practiseHref: `${catalogBase}?q_type=${encodeURIComponent(type)}`,
  }));
  const akTypes: AKType[] = perType.map(([type]) => ({ type, label: qtypeLabel(type) }));
  const akItems: AKItem[] = result.perQuestion.map((q) => {
    const m = meta.get(q.number)!;
    const given = Array.isArray(q.given) ? q.given.join(", ") : q.given;
    const base: AKItem = {
      number: q.number,
      qtype: q.qtype,
      label: qtypeLabel(q.qtype),
      correct: q.correct,
      given: given && given !== "" ? given : "—",
    };
    if (!fullReview) return base;
    const ev = m.evidence as { para: string; snippet: string } | null;
    return {
      ...base,
      answer: (m.accept as string[]).join(" / "),
      explanation: m.explanation,
      evidence: ev?.snippet ?? null,
    };
  });

  return (
    <AppShell active={section}>
      <style>{RESULT_CSS}</style>
      <div style={S.wrap}>
        <div style={S.backRow}>
          <Button variant="ghost" size="sm" icon="arrow-left" href={catalogBase}>
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

        {/* Insight hero — the verdict: what's costing you the most, with score */}
        <div style={S.hero}>
          <div className="res-herogrid" style={S.heroGrid}>
            <div style={S.scoreStack}>
              <AnimatedDonut pct={correctPct} />
              <div style={{ textAlign: "center" }}>
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
            <div style={{ minWidth: 0 }}>
              {weakest ? (
                <>
                  <div style={S.verdictEy}>Your biggest gap</div>
                  <h2 className="res-verdict" style={S.verdict}>
                    <span style={S.verdictEm}>{qtypeLabel(weakest[0])}</span> is where you lose
                    the most — {weakest[1].correct} of {weakest[1].total} right.
                  </h2>
                  <p style={S.verdictSub}>
                    Closing one weak type lifts your score faster than grinding full tests.
                    Start here, then re-test.
                  </p>
                  <div style={S.verdictCta}>
                    <Button href={`${catalogBase}?q_type=${encodeURIComponent(weakest[0])}`} trailingIcon="arrow-right">
                      Drill {qtypeLabel(weakest[0])}
                    </Button>
                    <Button variant="ghost" href="#answer-key">
                      See all answers
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div style={S.verdictEy}>Your result</div>
                  <h2 className="res-verdict" style={S.verdict}>
                    You got {result.rawScore} of {result.total} right.
                  </h2>
                  <p style={S.verdictSub}>
                    Review every question below to see exactly where your points went.
                  </p>
                </>
              )}
            </div>
          </div>
          {metrics.length > 0 && (
            <div className="res-herometrics" style={S.heroMetrics}>
              {metrics.map((m) => (
                <div key={m.label} style={S.metricTile}>
                  <div style={{ ...S.metricValue, color: m.color }}>{m.value}</div>
                  <div style={S.metricLabel}>{m.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Accuracy by type — tap a type to reveal which questions you missed */}
        {accRows.length > 0 && <AccuracyByType rows={accRows} />}

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
              <Button href={`${catalogBase}?q_type=${encodeURIComponent(weakest[0])}`} trailingIcon="arrow-right" style={{ flex: "none" }}>
                Start
              </Button>
            </div>
          </FadeUp>
        )}

        {/* Answer key. Everyone sees right/wrong per question. The correct answer,
            explanation and text evidence are revealed only when `fullReview` is
            true — currently free for all (REVIEW_OPEN). When the flag is closed,
            those props aren't rendered, so the answer_key never reaches the HTML. */}
        <section id="answer-key" style={{ marginTop: 18, scrollMarginTop: 80 }}>
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
          <AnswerKeyFilter items={akItems} types={akTypes} />
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
          <Button variant="secondary" fullWidth href={catalogBase}>
            Back to catalog
          </Button>
          <Button fullWidth trailingIcon="arrow-right" href={retryHref}>
            Try again
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

// Адаптив result-героя. База = мобильный (донат-стек над вердиктом); ≥620px =
// две колонки. Переключаемые grid-свойства живут в классах, не inline (иначе
// inline перебивает media-query — responsive-inline-class invariant).
const RESULT_CSS = `
.res-herogrid{grid-template-columns:1fr;gap:18px}
.res-herometrics{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
.res-verdict{text-wrap:balance}
@media (min-width:620px){
  .res-herogrid{grid-template-columns:auto 1fr;gap:26px}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column" },
  backRow: { display: "flex", alignItems: "center", marginBottom: 4 },

  repHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  repSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  // Insight hero
  hero: { position: "relative", overflow: "hidden", background: "radial-gradient(120% 140% at 0% 0%, var(--violet-100), transparent 55%), var(--surface)", border: "1px solid var(--brand-border)", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-md)", padding: 24, marginBottom: 14 },
  heroGrid: { display: "grid", alignItems: "center" },
  scoreStack: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  verdictEy: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand)", marginBottom: 8 },
  verdict: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", lineHeight: 1.16, margin: "0 0 8px", color: "var(--text-primary)" },
  verdictEm: { color: "var(--brand)" },
  verdictSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", maxWidth: "46ch", margin: "0 0 16px", lineHeight: 1.5 },
  verdictCta: { display: "flex", gap: 10, flexWrap: "wrap" },
  heroMetrics: { display: "grid", gap: 10, marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" },

  metricEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  bandBig: { fontFamily: "var(--font-mono)", fontSize: 46, fontWeight: 600, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.02em" },
  rawLine: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 },
  metricTile: { background: "var(--surface-inset)", borderRadius: 12, padding: "12px 14px" },
  metricValue: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", fontWeight: 600 },
  metricLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", fontWeight: 600, marginTop: 2 },

  recoCard: { display: "flex", alignItems: "center", gap: 14, border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", borderRadius: "var(--radius-xl)", padding: "16px 20px", boxShadow: "var(--shadow-solid)", marginBottom: 14, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  recoIcon: { flex: "none", color: "var(--brand)" },

  reviewHead: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" },
  h2: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, margin: 0, color: "var(--text-primary)" },

  upsell: { marginTop: 18, border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", borderRadius: "var(--radius-xl)", padding: "1.4rem 1.3rem", textAlign: "center" },
  upsellTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, color: "var(--text-link)" },
  upsellText: { fontFamily: "var(--font-ui)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: ".5rem auto 1rem", maxWidth: 440, lineHeight: 1.5 },

  footer: { marginTop: 24, display: "flex", gap: 10 },
};
