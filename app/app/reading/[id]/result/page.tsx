import { and, asc, desc, eq, exists, isNotNull, lt, ne, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, attemptReviewSnapshot, contentItem, question } from "@/db/schema";
import { getActiveBadges } from "@/lib/content/badges";
import { getProfile, getUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { grade, type GradeKey } from "@/lib/grading/grade";
import type { ReviewSnapshot } from "@/lib/exam/review-snapshot";
import { blindSpotTag, buildShareHeadline, computeBlindSpot, computeGrowth, computeNearMiss, stripHtml, type DebriefData } from "@/lib/result/debrief";
import { effectiveTier, hasFullReview, type Tier } from "@/lib/tiers";
import { isUuid } from "@/lib/uuid";
import { qtypeDescription, qtypeLabel } from "@/lib/labels";
import { AppShell } from "../../../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import Debrief from "./Debrief";
import { AnswerKeyFilter, type AKItem, type AKType } from "./InsightReport";

export const dynamic = "force-dynamic";

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Единая форма строки разбора — из D3-snapshot или (legacy) живого answer_key. */
type ReviewRow = {
  number: number;
  qtype: string;
  mode: GradeKey["mode"];
  accept: string[];
  explanation: string | null;
  evidence: { para: string; snippet: string } | null;
};

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
  // Malformed id / ?a= never reach the uuid-column queries (would 500 on cast); 404 instead.
  if (!isUuid(id) || !isUuid(attemptId)) notFound();

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
  const [attRows, profile, liveRows, snapRows, ci, pctRow, prevRows] = await Promise.all([
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
    // D3: snapshot разбора (server-only locked-таблица attempt_review_snapshot).
    // EXISTS-гард владения — как у answer_key выше: БД отдаёт snapshot ТОЛЬКО для
    // attempt этого юзера на этот тест (defense-in-depth до JS-проверки).
    db
      .select({ snapshot: attemptReviewSnapshot.snapshot })
      .from(attemptReviewSnapshot)
      .where(
        and(
          eq(attemptReviewSnapshot.attemptId, attemptId),
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
      .limit(1),
    db
      .select({
        title: contentItem.title,
        category: contentItem.category,
        section: contentItem.section,
        durationSeconds: contentItem.durationSeconds,
        // Только флаг наличия раннера для маршрутизации «Try again» — НЕ сам
        // runner_html (~200КБ); как в каталоге (getPublishedTests).
        hasRunner: sql<boolean>`${contentItem.runnerHtml} IS NOT NULL`,
        // Debrief near-miss (S1): шкала raw→band для computeNearMiss. Только
        // Full-тесты (40Q) её имеют; одиночный passage/part -> null (только %).
        bandScale: contentItem.bandScale,
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
    // История ПРЕДЫДУЩИХ submitted-попыток на этом тесте, самая свежая первой.
    // prevRows[0] остаётся «прошлая попытка» для дельт («Band since last» /
    // «Since last test» ниже) — раньше это был limit(1); теперь читаем всю
    // историю (+ per_type_breakdown) одним тем же запросом, чтобы computeGrowth
    // (S4 «1st/2nd/now») не открывал отдельный round-trip. Граница по времени =
    // att.submitted_at коррелированным подзапросом по attemptId.
    db
      .select({
        rawScore: attempt.rawScore,
        bandScore: attempt.bandScore,
        perTypeBreakdown: attempt.perTypeBreakdown,
      })
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
      .orderBy(desc(attempt.submittedAt)),
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

  // D3: предпочитаем snapshot, снятый на момент сдачи, ЖИВОМУ answer_key — иначе
  // разбор «плывёт» при позднейшей правке контента. Fallback на live-ключ для
  // legacy-попыток без snapshot (сданных до миграции 0021). Обе ветки сводятся к
  // единой форме ReviewRow.
  const snap = (snapRows[0]?.snapshot as ReviewSnapshot | undefined) ?? null;
  const rows: ReviewRow[] = snap
    ? snap.questions.map((q) => ({
        number: q.number,
        qtype: q.qtype,
        mode: q.mode,
        accept: q.accept,
        explanation: q.explanation,
        evidence: q.evidence,
      }))
    : liveRows.map((r) => ({
        number: r.number,
        qtype: r.qtype,
        mode: r.mode,
        accept: (r.accept as string[]) ?? [],
        explanation: r.explanation,
        evidence: (r.evidence as { para: string; snippet: string } | null) ?? null,
      }));

  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: r.accept,
  }));
  // Балл пересчитывается grade() по ключам snapshot (стабилен), а не по live-ключу.
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
  const shareHeadline = buildShareHeadline(banded, banded ? Number(att.bandScore) : null, result.percent);

  // Answer-key appendix data (Variant A), built from the already-loaded grade
  // result (no extra queries, perf-safe). The answer_key fields are attached
  // ONLY when fullReview, so a gated user's HTML never carries them.
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
      // Ungated (derive-добавка §e-2) — generic per-type reference, unlike the
      // gated per-question `explanation` below.
      strategy: qtypeDescription(q.qtype),
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

  // Debrief data layer (S1-S5 «дебриф», rendered by <Debrief/> below). Every
  // field is a plain derivation of data already fetched/graded above — no new
  // queries. `missed` is the safe subset (number/qtype only, no answer key) —
  // rendered even when gated; `replay` carries answer/why/evidence and is
  // built ONLY when fullReview, mirroring the akItems gate above.
  const bandScale = (ci[0]?.bandScale as Record<string, number> | null) ?? null;
  const nearMiss = computeNearMiss(bandScale, result.rawScore);
  // На идеальной/ровной попытке weakest всё равно указывает на какой-то тип
  // (perType всегда непусто), но там нечего чинить — costMarks === 0. Гейт на
  // реальную потерю баллов, иначе S2/S5 придумывают "слабый тип" из воздуха.
  const weakestCostMarks = weakest ? weakest[1].total - weakest[1].correct : 0;
  const blindSpot: DebriefData["blindSpot"] =
    computeBlindSpot(result.perQuestion, meta) ??
    (weakest && weakestCostMarks > 0
      ? {
          label: qtypeLabel(weakest[0]),
          weakBucket: { correct: weakest[1].correct, total: weakest[1].total },
          strongBucket: null,
          costMarks: weakestCostMarks,
        }
      : null);
  // Хронологический ряд для computeGrowth: prevRows приходит most-recent-first
  // (нужен для метрик выше) — переворачиваем и дописываем текущую попытку
  // последней («now»), её breakdown ещё не в БД на момент чтения /result.
  const growthHistory = [...prevRows]
    .reverse()
    .map((r) => ({ perTypeBreakdown: (r.perTypeBreakdown as Record<string, { correct: number; total: number }> | null) ?? null }))
    .concat([{ perTypeBreakdown: result.perType }]);
  const growth = computeGrowth(growthHistory, weakest ? weakest[0] : null);
  const levelRows: DebriefData["level"]["rows"] = perType.map(([type, s], i) => ({
    type,
    label: qtypeLabel(type),
    correct: s.correct,
    total: s.total,
    weak: i === 0,
    practiseHref: `${catalogBase}?q_type=${encodeURIComponent(type)}`,
  }));
  const missed: DebriefData["missed"] = result.perQuestion
    .filter((q) => !q.correct)
    .map((q) => ({ number: q.number, qtype: q.qtype, label: qtypeLabel(q.qtype) }));
  // Re-pick интерактивен только для tfng/ynng (decision §3) — фиксированный набор
  // опций, независимый от question.options (тот нужен только mcq-раннеру).
  const TERNARY_OPTIONS: Record<string, string[]> = {
    tfng: ["TRUE", "FALSE", "NOT GIVEN"],
    ynng: ["YES", "NO", "NOT GIVEN"],
  };
  // promptHtml уже загружен в liveRows (безусловный запрос выше, не зависит от
  // snapshot) — переиспользуем вместо нового round-trip.
  const promptByNumber = new Map(liveRows.map((r) => [r.number, r.promptHtml]));
  const replay: DebriefData["replay"] = !fullReview
    ? []
    : result.perQuestion
        .filter((q) => !q.correct)
        .map((q) => {
          const m = meta.get(q.number)!;
          const given = Array.isArray(q.given) ? q.given.join(", ") : q.given;
          return {
            number: q.number,
            type: qtypeLabel(q.qtype),
            stem: stripHtml(promptByNumber.get(q.number) ?? ""),
            options: TERNARY_OPTIONS[q.qtype] ?? null,
            given: given && given !== "" ? given : "—",
            answer: m.accept.join(" / "),
            why: m.explanation,
            evidence: m.evidence?.snippet ?? null,
            tag: blindSpotTag({ qtype: q.qtype, accept: m.accept }, blindSpot),
          };
        });

  const debriefData: DebriefData = {
    title,
    category,
    totalQuestions: result.total,
    catalogBase,
    retryHref,
    score: {
      raw: result.rawScore,
      total: result.total,
      correctPct,
      banded,
      band: banded ? Number(att.bandScore) : null,
      nextBand: banded ? nearMiss.nextBand : null,
      marksToNext: banded ? nearMiss.marksToNext : null,
    },
    metrics,
    blindSpot,
    missed,
    replayLocked: !fullReview,
    replay,
    level: { rows: levelRows, avgPct: correctPct, growth },
    plan: {
      weakLabel: weakest && weakestCostMarks > 0 ? qtypeLabel(weakest[0]) : null,
      drillHref: weakest && weakestCostMarks > 0 ? `${catalogBase}?q_type=${encodeURIComponent(weakest[0])}` : null,
      retryHref,
    },
    share: profile?.referral_code ? { refCode: profile.referral_code, headline: shareHeadline } : null,
  };

  return (
    <AppShell active={section}>
      <style>{RESULT_CSS}</style>
      <div style={S.wrap}>
        <div style={S.backRow}>
          <Button variant="ghost" size="sm" icon="arrow-left" href={catalogBase}>
            Catalog
          </Button>
        </div>

        <Debrief data={debriefData} unlockedBadges={unlockedBadges} />

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

        <div className="res-footer" style={S.footer}>
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

// Два fullWidth-Button (Back to catalog / Try again) в ряд теснятся на узких
// телефонах — переключаемое свойство живёт в классе, не inline (иначе inline
// перебивает media-query — responsive-inline-class invariant).
const RESULT_CSS = `
@media (max-width:430px){
  .res-footer{flex-direction:column}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "16px 18px 40px", display: "flex", flexDirection: "column" },
  backRow: { display: "flex", alignItems: "center", marginBottom: 4 },

  reviewHead: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" },
  h2: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, margin: 0, color: "var(--text-primary)" },

  footer: { marginTop: 24, display: "flex", gap: 10 },
};
