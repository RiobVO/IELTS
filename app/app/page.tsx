import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getVocabDueSummary, type VocabDueSummary } from "@/lib/vocab/summary";
import { db } from "@/db";
import { attempt, contentItem, leaderboardEntry } from "@/db/schema";
import { categoryLabel, qtypeLabel, LISTENING_CATEGORIES } from "@/lib/labels";
import { computeBandPlan, type BandPlan, type BandPlanWeakType } from "@/lib/progress/band-plan";
import { AppShell } from "./_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";

type Breakdown = Record<string, { correct: number; total: number }> | null;

interface AttemptRow {
  id: string;
  content_item_id: string;
  raw_score: number | null;
  band_score: string | null;
  per_type_breakdown: Breakdown;
  submitted_at: string | null;
  content_item: { title: string; category: string; band_scale: Record<string, number> | null } | null;
}

function total(b: Breakdown): number {
  if (!b) return 0;
  return Object.values(b).reduce((s, x) => s + x.total, 0);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Календарный ключ дня по UTC — для дедупа активности и сравнения дней недели. */
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

/** Относительное время сабвита: Today / Yesterday / N days ago / дата. */
function relTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d1 = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const days = Math.round((d0 - d1) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** Чистим болванку «IELTS Reading Test - …» из титула (§4/§8). */
const cleanTitle = (t: string) => t.replace(/^IELTS (Reading|Listening)( Test)?\s*[-—]\s*/, "");

/** Худший тип в разбивке ОДНОЙ попытки (min accuracy, tiebreak — больше промахов). */
function worstType(b: Breakdown): { type: string; missed: number } | null {
  if (!b) return null;
  let best: { type: string; acc: number; missed: number } | null = null;
  for (const [type, v] of Object.entries(b)) {
    if (v.total === 0 || v.correct === v.total) continue; // не зовём «weak» закрытое на 100%
    const acc = v.correct / v.total;
    const missed = v.total - v.correct;
    if (!best || acc < best.acc || (acc === best.acc && missed > best.missed)) best = { type, acc, missed };
  }
  return best ? { type: best.type, missed: best.missed } : null;
}

type Chip = { kind: "weak" | "up" | "rev"; text: string };

export default async function Dashboard() {
  const user = await requireUser();
  const supabase = await createClient();

  // Профиль / список попыток / глобальный ранг независимы → один Promise.all
  // (без водопада). Ранг читается owner-путём, но строго по своему user_id.
  const [profile, attemptsRes, rankRows, leagueCountRows, inProgressRows, vocabSummary] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select(
        // +band_scale (гранчен 0035) — для §1 band-gain, без нового round-trip.
        "id,content_item_id,raw_score,band_score,per_type_breakdown,submitted_at,content_item:content_item_id(title,category,band_scale)",
      )
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(20),
    db
      .select({ rank: leaderboardEntry.rank })
      .from(leaderboardEntry)
      .where(
        and(
          eq(leaderboardEntry.userId, user.id),
          eq(leaderboardEntry.period, "all_time"),
          eq(leaderboardEntry.scope, "global"),
        ),
      )
      .limit(1),
    // §6 — знаменатель лиги (тот же period/scope, что rank).
    db
      .select({ n: count() })
      .from(leaderboardEntry)
      .where(and(eq(leaderboardEntry.period, "all_time"), eq(leaderboardEntry.scope, "global"))),
    // §5 — последняя in_progress попытка (owner-path: нужен has_runner, runner_html не гранчен).
    db
      .select({
        contentItemId: attempt.contentItemId,
        answers: attempt.answers,
        title: contentItem.title,
        hasRunner: sql<boolean>`${contentItem.runnerHtml} is not null`,
      })
      .from(attempt)
      .innerJoin(contentItem, eq(contentItem.id, attempt.contentItemId))
      // Повторяем RLS-условие published вручную: owner-path обходит политику,
      // а title непубликованного контента не должен светиться в Resume.
      .where(and(eq(attempt.userId, user.id), eq(attempt.status, "in_progress"), eq(contentItem.status, "published")))
      .orderBy(desc(attempt.startedAt))
      .limit(1),
    // Слим-сводка Vocabulary (due/streak/goal) для правого рейла — независима
    // от остальных данных дашборда, читается в той же волне.
    getVocabDueSummary(user.id),
    // Пре-варм данных шапки конкурентно с телом дашборда (cache()'d; AppShell
    // переиспользует — убирает trailing notification-хоп).
    getHeaderData(),
  ]);

  // One-time onboarding gate (W1-2): until the user captures their profile we
  // can't show a band target or a named leaderboard entry. Send them there.
  if (profile && !profile.onboarded_at) redirect("/app/onboarding");

  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];

  const name = (profile?.display_name as string | null)?.split(" ")[0] || "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const streak = profile?.current_streak ?? 0;
  const xp = profile?.xp ?? 0;
  const rating = profile?.rating ?? 1000;
  const bandTarget = profile?.target_band != null ? Number(profile.target_band) : null;
  const globalRank = rankRows[0]?.rank ?? null;

  // Последняя попытка с band (single-passage тесты band не имеют).
  const banded = attempts.find((a) => a.band_score != null);
  const bandLatest = banded?.band_score != null ? Number(banded.band_score) : null;
  // Тултип «откуда band»: тест-источник, raw-счёт, давность (hover/focus на цифре).
  const bandSrc = banded
    ? `${cleanTitle(banded.content_item?.title ?? "Full mock")} · ${banded.raw_score ?? "—"}/${total(banded.per_type_breakdown) || 40}${banded.submitted_at ? ` · ${relTime(banded.submitted_at)}` : ""}`
    : null;

  // Week-dots — реальная активность за последние 7 дней (из submitted_at). Считаем
  // НЕ только факт практики, но и число тестов за день — для hover-подсказки столбца.
  const dayCount = new Map<string, number>();
  for (const a of attempts) {
    if (!a.submitted_at) continue;
    const k = dayKey(new Date(a.submitted_at));
    dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
  }
  const now = new Date();
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - i)),
    );
    const count = dayCount.get(dayKey(d)) ?? 0;
    const isToday = i === 6;
    return {
      lab: DOW[d.getUTCDay()],
      name: d.toLocaleDateString("en-US", { weekday: "long" }),
      count,
      state: isToday ? "today" : count > 0 ? "on" : "off",
    } as const;
  });

  // Weak areas / band-gain / drill недели — считает ОДНО чистое ядро computeBandPlan
  // (шарится с weekly digest, см. src/lib/progress/band-plan.ts), больше не
  // дублируем агрегацию инлайн. Секцию (reading/listening) для попытки по-прежнему
  // маппим сами по её category — это часть контракта входа билдера, а не запрос.
  const listeningCats = new Set<string>(LISTENING_CATEGORIES);
  const bandPlan = computeBandPlan(
    attempts.map((a) => ({
      bandScore: a.band_score != null ? Number(a.band_score) : null,
      rawScore: a.raw_score,
      perTypeBreakdown: a.per_type_breakdown,
      section: listeningCats.has(a.content_item?.category ?? "") ? "listening" : "reading",
      bandScale: a.content_item?.band_scale ?? null,
      submittedAt: a.submitted_at,
    })),
    bandTarget,
  );
  const weak = bandPlan.weakTypes;
  const weakest = weak[0] ?? null;
  const hasAttempts = attempts.length > 0;

  // Доля верных по ВСЕМ типам (не только top-5 weak-список) — для тёплой строки
  // нормализации, когда юзер реально буксует. Бренд candid, но не карающий: не
  // сыпать «worst / lose points» без поддержки в самый уязвимый момент
  // (ученик-не-носитель на низком старте).
  let struggCorrect = 0;
  let struggTotal = 0;
  for (const a of attempts) {
    if (!a.per_type_breakdown) continue;
    for (const v of Object.values(a.per_type_breakdown)) {
      struggCorrect += v.correct;
      struggTotal += v.total;
    }
  }
  const struggling = struggTotal > 0 && struggCorrect / struggTotal < 0.35;

  // §1 — «приз» hero, теперь из bandPlan.drill (та же честная оценка: реальная
  // band-шкала теста, где слабейший тип встречался, не кросс-попыточная сумма).
  const bandPill = bandPlan.drill?.bandGain != null ? `≈ +${bandPlan.drill.bandGain.toFixed(1)} band if fixed` : null;
  const drillMin = bandPlan.drill?.estMinutes ?? null;

  // §3 — сколько тестов «видели» слабейший тип (для zero-state readout).
  const seenTests = weakest
    ? attempts.filter((a) => (a.per_type_breakdown?.[weakest.qtype]?.total ?? 0) > 0).length
    : 0;

  // §4 — последние 5 показанных попыток + дельта-чип к предыдущей попытке той же
  // категории (сравнение внутри уже загруженных attempts, без нового запроса).
  const shown = attempts.slice(0, 5);
  const chipFor = (idx: number): Chip => {
    const a = shown[idx];
    if (a.band_score == null) return { kind: "rev", text: "review answers →" }; // single-passage, без band
    let prev: AttemptRow | undefined;
    for (let j = idx + 1; j < attempts.length; j++)
      if (attempts[j].content_item?.category === a.content_item?.category) { prev = attempts[j]; break; }
    if (!prev) return { kind: "up", text: "first mock ✓" };
    const d = (a.raw_score ?? 0) - (prev.raw_score ?? 0);
    if (d > 0) return { kind: "up", text: `+${d} vs last` };
    if (d < 0) return { kind: "weak", text: `${d} vs last` }; // d уже с минусом → «−4 vs last»
    return { kind: "up", text: "matched last" };
  };

  // §5 — умный Resume: последняя in_progress попытка → маршрут по has_runner.
  const ip = inProgressRows[0];
  const resume = ip
    ? {
        href: ip.hasRunner ? `/app/exam/${ip.contentItemId}` : `/app/reading/${ip.contentItemId}`,
        // Full-reading титулы = «Пассаж / Пассаж / Пассаж» — для кнопки хватает первого.
      title: cleanTitle(ip.title).split(" / ")[0],
        // Курсора в схеме нет → номер = отвеченных + 1 (приблизительно, для подсказки).
        q:
          Object.values((ip.answers ?? {}) as Record<string, unknown>).filter((v) =>
            Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== "",
          ).length + 1,
      }
    : null;

  // §6 — знаменатель лиги (тот же period/scope, что rank).
  const leagueTotal = leagueCountRows[0]?.n ?? null;

  return (
    <AppShell active="dashboard">
      <style>{DASH_CSS}</style>
      <div className="dash-wrap" style={S.wrap}>
        {/* Greeting — span на обе колонки */}
        <div className="dash-grid-span" style={S.greet}>
          <div>
            <h1 className="dash-hi" style={S.hi}>Hi, {name}</h1>
          </div>
          <div style={S.date}>{today}</div>
        </div>

        {/* Focus — единственный визуальный якорь, full-width */}
        <FocusCard weakest={weakest} weakCount={weak.length} seenTests={seenTests} bandPill={bandPill} drillMin={drillMin} hasAttempts={attempts.length > 0} />

        <div className="dash-col-main">
          {/* Next up — сразу под фокусом (ядро экрана) */}
          {weak.length > 1 && (
            <div className="dash-sect" style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <h2 style={S.sectionTitle}>Next up</h2>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600 }}>after today&apos;s focus</span>
                <Link href="/app/reading" style={S.drillAny}>Browse all →</Link>
              </div>
              {struggling && (
                <p style={S.lossNorm}>
                  Everyone starts here — pick one type and your band climbs faster than you think.
                </p>
              )}
              {weak.slice(1, 4).map((w, i) => (
                <LossRow key={w.qtype} item={w} idx={i + 1} />
              ))}
              {weak.length > 4 && (
                <details className="dash-more">
                  <summary style={S.moreSummary}>
                    Show {weak.length - 4} more
                    <Icon name="chevron-down" size={16} strokeWidth={2.4} />
                  </summary>
                  {weak.slice(4).map((w, i) => (
                    <LossRow key={w.qtype} item={w} idx={i + 4} />
                  ))}
                </details>
              )}
            </div>
          )}

          {/* Ровно один слабый тип: список пуст (он в hero), но эмпатию нулевого старта не теряем */}
          {weak.length === 1 && struggling && (
            <div className="dash-sect" style={S.card}>
              <p style={S.lossNorm}>
                Everyone starts here — pick one type and your band climbs faster than you think.
              </p>
            </div>
          )}

          {/* Recent tests */}
          <div className="dash-sect-tight" style={S.card}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ ...S.sectionTitle, fontSize: "var(--text-lg)" }}>Recent tests</h2>
              <Link href="/app/reading" style={S.drillAny}>
                View all →
              </Link>
            </div>
            {attempts.length === 0 ? (
              <div style={S.empty}>
                No tests yet. Take your first test from the catalog — your score and per-type
                breakdown will show up here.
              </div>
            ) : (
              shown.map((a, i) => <TestRow key={a.id} a={a} chip={chipFor(i)} />)
            )}
          </div>
        </div>

        <div className="dash-col-rail">
          {/* Band readout */}
          <BandReadout band={bandLatest} target={bandTarget} source={bandSrc} hasAttempts={hasAttempts} />

          {/* Plan to target band (W2-5) — дистанция + дрилл недели из bandPlan */}
          <PlanCard plan={bandPlan} hasAttempts={hasAttempts} />

          {/* This week — тонкая полоса momentum под диагностикой, не co-hero */}
          <WeekCard streak={streak} xp={xp} rating={rating} rank={globalRank} week={week} resume={resume} leagueTotal={leagueTotal} />

          {/* Vocabulary — слим-модуль сводки (due/streak/goal), приватный от рейтинга */}
          <VocabCard summary={vocabSummary} />
        </div>
      </div>
    </AppShell>
  );
}

/* Focus hero — слабейший тип как фокус дня + «приз» (band-gain/drill-time) и
   zero-state спарклайн (§1/§3); для нового юзера — заход в первый тест. */
function FocusCard({
  weakest, weakCount, seenTests, bandPill, drillMin, hasAttempts,
}: {
  weakest: BandPlanWeakType | null; weakCount: number; seenTests: number; bandPill: string | null; drillMin: number | null; hasAttempts: boolean;
}) {
  const zero = weakest ? weakest.correct === 0 : false;
  const pct = weakest ? Math.round((weakest.correct / weakest.total) * 100) : 0;
  return (
    <div className="dash-focus dash-grid-span" style={S.focus}>
      <div style={S.focusInner}>
        <div style={S.focusEyebrow}>
          <Icon name="target" size={15} strokeWidth={2.6} /> Today&apos;s focus
          {weakest && weakCount > 1 && <span style={{ opacity: 0.85 }}> · worst of {weakCount}</span>}
        </div>
        {weakest ? (
          <>
            <h2 className="dash-focus-title" style={S.focusTitle}>{weakest.label}</h2>
            <p style={S.focusText}>
              {zero
                ? "No correct answers logged yet — clearing this type is the fastest band you'll gain."
                : `${weakest.total} answers mapped, ${weakest.correct} right — this single type is holding the most points.`}
            </p>
            <div style={{ marginTop: 22 }}>
              <div style={S.focusProgHead}>
                <span style={S.focusProgLabel}>{zero ? "Seen so far" : "Accuracy"}</span>
                <span style={S.focusProgVal}>
                  {zero ? `${weakest.total} questions · ${seenTests} ${seenTests === 1 ? "test" : "tests"}` : `${weakest.correct} / ${weakest.total}`}
                </span>
              </div>
              {zero ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                  <span aria-hidden="true" style={S.spark}><i style={S.sparkBar} /><i style={S.sparkBar} /><i style={S.sparkBar} /></span>
                  <span style={S.sparkHint}>first correct answer starts your streak here</span>
                </div>
              ) : (
                <div aria-hidden="true" style={S.focusTrack}>
                  <div style={{ ...S.focusFill, width: `${pct}%` }} />
                </div>
              )}
            </div>
            {(bandPill || drillMin != null) && (
              <div style={S.focusPills}>
                {bandPill && <span style={S.focusPill}>{bandPill}</span>}
                {drillMin != null && <span style={S.focusPill}>~{drillMin} min drill</span>}
              </div>
            )}
            <div style={S.focusCta}>
              <Button variant="secondary" size="lg" trailingIcon="arrow-right" href={`/app/${weakest.section}?q_type=${encodeURIComponent(weakest.qtype)}`} style={{ color: "var(--brand-active)" }}>
                Fix this weakness
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Два разных пустых состояния: совсем без попыток — зови в первый тест;
                попытки есть, но ни один тип не набрал порог доверия aggregateWeakness
                (<4 ответов на тип) — честно объясняем, что данных мало, а не молчим
                и не рекомендуем по шуму. */}
            <h2 className="dash-focus-title" style={S.focusTitle}>
              {hasAttempts ? "Almost there" : "Take your first test"}
            </h2>
            <p style={S.focusText}>
              {hasAttempts
                ? "Not enough answers per question type yet — one more test reveals your weak spot, and we'll point your daily focus straight at it."
                : "Sit a test to surface your weakest question type — then we'll point your daily focus straight at it."}
            </p>
            <div style={S.focusCta}>
              <Button variant="secondary" size="lg" trailingIcon="arrow-right" href="/app/reading" style={{ color: "var(--brand-active)" }}>
                {hasAttempts ? "Take one more test" : "Browse tests"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Текст hover-подсказки дня: коротко (сам день читается из позиции столбца), чтобы
   подсказка не уезжала за край вьюпорта на мобиле. */
function weekdayTip(w: { name: string; count: number; state: "today" | "on" | "off" }): string {
  const tests = (n: number) => `${n} test${n === 1 ? "" : "s"}`;
  if (w.state === "today") return w.count > 0 ? `Today · ${tests(w.count)}` : "Today";
  if (w.state === "on") return tests(w.count);
  return "No practice";
}

/* This week — momentum-полоса (streak | неделя активности | лига | continue),
   демоут под диагностику. На телефоне сегменты стопкой, на десктопе в ряд. */
function WeekCard({
  streak,
  xp,
  rating,
  rank,
  week,
  resume,
  leagueTotal,
}: {
  streak: number;
  xp: number;
  rating: number;
  rank: number | null;
  week: readonly { lab: string; name: string; count: number; state: "today" | "on" | "off" }[];
  resume: { href: string; title: string; q: number } | null;
  leagueTotal: number | null;
}) {
  const barH = (n: number) => (n <= 0 ? 6 : n === 1 ? 16 : n === 2 ? 24 : 30);
  const barFill = (n: number) =>
    n <= 0 ? "var(--surface-inset)"
    : n === 1 ? "color-mix(in oklab, var(--streak) 45%, var(--surface))"
    : n === 2 ? "color-mix(in oklab, var(--streak) 65%, var(--surface))"
    : "var(--streak)";
  // Доступное имя дня для скринридера; видимая буква S/M/T… остаётся aria-hidden.
  const dayState = { today: "today", on: "practiced", off: "no practice" } as const;
  return (
    <div className="dash-week" style={S.card}>
      <div className="dash-week-row">
        <div style={S.weekStats}>
          <span style={S.flameIc}>
            <Icon name="flame" size={24} strokeWidth={2.2} />
          </span>
          <div>
            <div style={S.flameNum}>{streak}</div>
            <div style={S.flameSub}>day streak</div>
          </div>
          <div style={{ marginLeft: 6 }}>
            <div style={{ ...S.flameNum, fontSize: 22 }}>{fmt(xp)}</div>
            <div style={S.flameSub}>XP</div>
          </div>
        </div>
        <div className="dash-week-dots">
          {week.map((w, i) => (
            <div
              key={i}
              className="weekday"
              role="img"
              aria-label={`${w.name}: ${dayState[w.state]}`}
              tabIndex={0}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
            >
              <div aria-hidden="true" style={{
                width: "100%", height: barH(w.count), borderRadius: 9, background: barFill(w.count),
                ...(w.state === "today"
                  ? { outline: "2px solid color-mix(in oklab, var(--streak) 35%, var(--surface))", outlineOffset: 2 }
                  : null),
              }} />
              <div aria-hidden="true" className="dash-week-lab" style={S.weekLab}>{w.lab}</div>
              {/* Hover-ридаут столбца: число тестов / today / rest — декоративный
                  (aria-hidden), доступную версию несёт aria-label ячейки. */}
              <span aria-hidden="true" className="daytip">{weekdayTip(w)}</span>
            </div>
          ))}
        </div>
        <Link href="/app/progress?tab=league" style={S.weekLeague}>
          <span style={S.leagueIcSm}>
            <Icon name="crown" size={18} strokeWidth={2.2} />
          </span>
          <span style={S.leagueName}>{rank != null ? "Global league" : "Unranked"}</span>
          {rank != null ? (
            <>
              <span style={S.leagueRank}>#{rank}</span>
              {leagueTotal != null && <span style={S.leagueTotal}>of {leagueTotal}</span>}
            </>
          ) : (
            <span style={S.leagueHint}>Take a rated test</span>
          )}
          {/* Голую Elo-цифру (rating) прячем до ranked — для не-носителя на старте
              «1000» это шум; показываем её только когда место в лиге уже есть. */}
          {rank != null && <span style={S.leagueRating}>{rating}</span>}
        </Link>
        {resume && (
          <div className="dash-week-cta">
            <Button variant="secondary" icon="play" href={resume.href}
              style={{ justifyContent: "center", background: "var(--surface-inset)", color: "var(--brand-active)", width: "100%", minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>Resume · {resume.title}</span>
              <span style={{ flex: "none" }}>— Q{resume.q}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Vocabulary — слим-модуль сводки (getVocabDueSummary), три состояния:
   due>0 (обычное — счётчик + бейджи + CTA), due=0 & streak>0 (all caught up,
   без лишнего CTA) и due=0 & streak=0 (банк слов пуст — компактный старт-CTA).
   Стрик/цель берутся ТОЛЬКО из summary — вне рейтинга/current_streak. */
function VocabCard({ summary }: { summary: VocabDueSummary }) {
  const { dueToday, streak, reviewedToday, goal } = summary;
  const zero = dueToday === 0 && streak === 0;
  const caughtUp = dueToday === 0 && streak > 0;

  return (
    <div style={{ ...S.card, ...S.vocabCard }} aria-label="Vocabulary summary">
      <div style={S.vocabTop}>
        <span style={S.vocabIc}>
          <Icon name="graduation-cap" size={19} strokeWidth={2.2} />
        </span>
        <div>
          <div style={S.vocabTitle}>Vocabulary</div>
          <div style={S.vocabLine}>
            {zero ? (
              "No cards started yet"
            ) : caughtUp ? (
              "All caught up"
            ) : (
              <>
                <span style={S.vocabNum}>{dueToday}</span> cards due today
              </>
            )}
          </div>
        </div>
      </div>

      {zero ? (
        <>
          <p style={S.vocabText}>Build your word bank — start your first deck.</p>
          <Button variant="primary" size="sm" trailingIcon="arrow-right" href="/app/vocabulary" style={S.vocabCta}>
            Start learning
          </Button>
        </>
      ) : (
        <>
          <div style={S.vocabBadges}>
            <span style={S.vocabBadgeStreak}>
              <Icon name="flame" size={12} strokeWidth={2.4} /> {streak}-day streak
            </span>
            {!caughtUp && <span style={S.vocabBadgeGoal}>{reviewedToday}/{goal} goal</span>}
          </div>
          {!caughtUp && (
            <Button variant="primary" size="sm" trailingIcon="arrow-right" href="/app/vocabulary" style={S.vocabCta}>
              Review now
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* Band readout — slim шкала band→target, в трёх честных состояниях (W1-4). */
function BandReadout({
  band,
  target,
  source,
  hasAttempts,
}: {
  band: number | null;
  target: number | null;
  source: string | null;
  hasAttempts: boolean;
}) {
  // Нет band → не рисуем фейковую шкалу: честный CTA в зависимости от истории.
  if (band == null) {
    return (
      <div className="dash-band" style={{ ...S.card, ...S.bandCard }}>
        <div style={{ flex: "none" }}>
          <div style={S.bandLabel}>Your band</div>
          <div style={S.bandEmptyNum}>—</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={S.bandEmptyText}>
            {hasAttempts
              ? "Band scores come from full 40-question mocks. Sit one to unlock yours."
              : "Take your first test to start tracking your band."}
          </p>
          <div style={{ marginTop: 12 }}>
            <Link href={hasAttempts ? "/app/reading?category=full_reading" : "/app/reading"} style={S.drillAny}>
              {hasAttempts ? "Sit a full mock →" : "Take a test →"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const fillPct = (band / 9) * 100;
  // Value-aware calm: a low band is shown quietly (softer ink, no elevation) —
  // candid, not punishing; a band worth celebrating keeps the bold raised look.
  const low = band < 5;
  const reached = target != null && band >= target;
  const nextStop = target != null ? Math.min(band + 0.5, target) : Math.min(band + 0.5, 9);
  const showMile = !reached && nextStop < (target ?? 9); // не дублируем target-тик
  const caption = reached
    ? "Target reached 🎯"
    : nextStop === target
      ? `Next stop: ${target} — your target, one mock away`
      : `Next stop: ${nextStop.toFixed(1)} — 1–2 types away`;
  const ariaLabel =
    target != null
      ? reached
        ? `Band ${band} of 9, target ${target}, reached`
        : `Band ${band} of 9, target ${target}, next stop ${nextStop}`
      : `Band ${band} of 9, next stop ${nextStop}`;
  return (
    <div style={{ ...S.card, ...S.bandCard, ...(low ? null : S.bandCardFilled) }}>
      <div style={{ flex: "none" }}>
        <div style={S.bandLabel}>Your band</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
          <span className="dash-bandnum-wrap" tabIndex={0} aria-label={source ? `From ${source}` : undefined}>
            <span className="dash-band-num" style={low ? { ...S.bandNum, color: "var(--text-secondary)" } : S.bandNum}>{band}</span>
            {source && <span aria-hidden="true" className="daytip">{source}</span>}
          </span>
          {target != null ? (
            <span style={S.bandTarget}>
              / target <span style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>{target}</span>
            </span>
          ) : (
            // Якорь шкалы для не-носителя, когда target ещё не задан. «out of 9»
            // (а не «/ 9») — чтобы не путать со слэш-грамматикой «/ target N».
            <span style={S.bandTarget}>out of 9</span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* §8 — a11y: шкала как единый образ со смыслом. */}
        <div role="img" aria-label={ariaLabel} style={S.bandScale}>
          <div style={{ ...S.bandFill, width: `${fillPct}%` }} />
          {showMile && <div style={{ ...S.bandTickMile, left: `calc(${(nextStop / 9) * 100}% - 2px)` }} />}
          {target != null && <div style={{ ...S.bandTick, left: `calc(${(target / 9) * 100}% - 2px)` }} />}
        </div>
        <div style={S.bandLegend}>
          <span>0</span>
          <span style={{ color: reached ? "var(--success-text)" : "var(--brand-active)", fontWeight: 700 }}>{caption}</span>
          <span>9</span>
        </div>
      </div>
    </div>
  );
}

/* Plan to target band (W2-5, BRIEF §12.3 шаг 2) — компакт-ридаут дистанции до
   target + рекомендованный drill недели по слабейшему типу. Общее ядро с weekly
   digest (computeBandPlan, src/lib/progress/band-plan.ts) — тот же дрилл юзер
   увидит и в письме. Деградирует мягко без target/попыток вместо пустой дыры. */
function PlanCard({ plan, hasAttempts }: { plan: BandPlan; hasAttempts: boolean }) {
  if (plan.targetBand == null) {
    return (
      <div style={{ ...S.card, ...S.planCard }}>
        <div style={S.planTitle}>Plan to target</div>
        <p style={S.planText}>Set a target band during onboarding to see your plan here.</p>
      </div>
    );
  }
  if (!hasAttempts) {
    return (
      <div style={{ ...S.card, ...S.planCard }}>
        <div style={S.planTitle}>Plan to band {plan.targetBand}</div>
        <p style={S.planText}>Take your first test to start tracking your distance to target.</p>
        <Link href="/app/reading" style={S.drillAny}>Take a test →</Link>
      </div>
    );
  }
  return (
    <div style={{ ...S.card, ...S.planCard }}>
      <div style={S.planTitle}>Plan to band {plan.targetBand}</div>
      {plan.currentBand == null ? (
        <p style={S.planText}>Sit a full 40-question mock to see your distance to target.</p>
      ) : plan.reached ? (
        <p style={S.planText}>Target reached 🎯 — keep practicing to hold it.</p>
      ) : (
        <p style={S.planText}>
          <span style={S.planDistance}>{plan.distance}</span> band{plan.distance === 1 ? "" : "s"} to go.
        </p>
      )}
      {plan.drill ? (
        <Link href={`/app/${plan.drill.section}?q_type=${encodeURIComponent(plan.drill.qtype)}`} style={S.planDrill}>
          <span>
            This week: {plan.drill.label} · ~{plan.drill.estMinutes} min
            {plan.drill.bandGain != null ? ` · ≈+${plan.drill.bandGain.toFixed(1)} band` : ""}
          </span>
          <Icon name="chevron-right" size={16} strokeWidth={2.2} />
        </Link>
      ) : (
        <p style={S.planText}>Keep practicing — we&apos;ll surface a focused drill once there&apos;s enough data.</p>
      )}
    </div>
  );
}

function LossRow({ item, idx }: { item: BandPlanWeakType; idx: number }) {
  const pct = Math.round((item.correct / item.total) * 100);
  const lost = item.total - item.correct;
  const worst = idx === 0;
  return (
    // Deep-link в дрилл этого типа В ЕГО СЕКЦИИ — listening-слабость не уводим в
    // reading (там её типа нет). /app/{section} редиректит в хаб практики, перенося
    // ?q_type в предвыбор фильтра.
    <Link className="dash-loss" href={`/app/${item.section}?q_type=${encodeURIComponent(item.qtype)}`} style={S.loss}>
      <span style={{ ...S.lossRank, ...(worst ? S.lossRankWorst : null) }}>{idx + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.lossName}>{item.label}</div>
        {/* Бар декоративный (aria-hidden): серьёзность несут ранг + счёт + «N missed».
            Один резкий акцент = бар худшей строки (full brand), остальные — спокойный
            brand-border; красный остаётся только на ранге худшей (lossRankWorst). */}
        <div aria-hidden="true" style={S.lossTrack}>
          <div style={{ height: "100%", width: `${pct}%`, borderRadius: "var(--radius-full)", background: worst ? "var(--brand)" : "var(--brand-border)" }} />
        </div>
      </div>
      <span style={S.lossScore}>
        {item.correct} / {item.total}
      </span>
      {worst && <span style={S.lossPts}>{lost} missed</span>}
      <span style={{ color: "var(--text-disabled)", flex: "none" }}>
        <Icon name="chevron-right" size={18} strokeWidth={2.2} />
      </span>
    </Link>
  );
}

function TestRow({ a, chip }: { a: AttemptRow; chip: Chip }) {
  const t = total(a.per_type_breakdown);
  const band = a.band_score != null ? Number(a.band_score) : null;
  const score = a.raw_score != null && t ? `${a.raw_score} / ${t}` : a.raw_score != null ? String(a.raw_score) : "—";
  const cat = a.content_item?.category ?? "";
  const listening = (LISTENING_CATEGORIES as readonly string[]).includes(cat);
  const worst = worstType(a.per_type_breakdown);
  const meta = `${a.content_item ? categoryLabel(cat) : ""}${a.submitted_at ? ` · ${relTime(a.submitted_at)}` : ""}`;
  return (
    <Link className="dash-trow" href={`/app/reading/${a.content_item_id}/result?a=${a.id}`} style={S.trow}>
      <span style={{ ...S.trowIc, ...(listening ? S.trowIcL : S.trowIcR) }}>{listening ? "L" : "R"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.trowTitle}>{cleanTitle(a.content_item?.title ?? "Test")}</div>
        <div style={S.trowMeta}>
          {meta}
          {worst && <> · <span style={{ color: "var(--error-text)", fontWeight: 600 }}>weak: {qtypeLabel(worst.type)}</span></>}
        </div>
      </div>
      <span className="dash-trow-tail" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {band != null && <Badge tone="brand" mono>band {band}</Badge>}
        <span className="dash-chip" style={{ ...S.chip, ...(chip.kind === "weak" ? S.chipWeak : chip.kind === "up" ? S.chipUp : S.chipRev) }}>{chip.text}</span>
        <span style={S.trowScore}>{score}</span>
      </span>
    </Link>
  );
}

// Адаптив дашборда. Переключаемые grid/flex/padding/размеры — здесь, не inline
// (иначе media-query проигрывает inline-стилю). База = мобильный, ≥768px = десктоп.
// Адаптив дашборда. DOM-порядок = визуальный (одна колонка), поэтому НИКАКОГО
// order/display:contents — фокус клавиатуры/скринридера идёт ровно как видно
// (focus → weakness → band → week → recent). Переключаемые по брейкпоинту свойства
// (padding / flex-direction / width) живут в классах, не inline.
const DASH_CSS = `
.dash-wrap{padding:20px 16px 48px;display:flex;flex-direction:column;gap:18px}
.dash-col-main,.dash-col-rail{display:flex;flex-direction:column;gap:18px;min-width:0}
.dash-hi{font-size:26px;white-space:normal}
.dash-focus{padding:26px}
.dash-focus-title{font-size:34px}
.dash-sect{padding:20px 16px}
.dash-sect-tight{padding:18px 16px 8px}
.dash-band{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.dash-band-num{font-size:50px}
/* Loss / recent — это ссылки: явный hover-фидбэк подтверждает кликабельность. */
.dash-loss,.dash-trow{transition:background-color var(--duration-fast) var(--ease-standard)}
.dash-loss:hover{background:var(--surface-inset)}
.dash-trow:hover{background:var(--surface-inset)}
.dash-more summary{list-style:none;cursor:pointer}
.dash-more summary::-webkit-details-marker{display:none}
.dash-more summary svg{transition:transform .2s ease}
.dash-more[open] summary svg{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){.dash-more summary svg,.dash-loss,.dash-trow{transition:none}}
/* This week — полоса momentum: телефон = сегменты стопкой, десктоп = в ряд. */
.dash-week{padding:16px}
.dash-week-row{display:flex;flex-direction:column;gap:16px;align-items:flex-start}
.dash-week-dots{display:flex;gap:7px;width:100%;align-items:flex-end}
.dash-week-cta{display:flex;justify-content:center;width:100%}
/* Hover-подсказка дня — брендовый dark-тултип над столбцом (mouse-enhancement;
   SR читает aria-label ячейки). reduced-motion гасится глобально в base.css. */
.weekday{position:relative}
.daytip{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translate(-50%,4px);padding:6px 10px;border-radius:var(--radius-sm);background:var(--slate-900);color:#fff;font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;white-space:nowrap;box-shadow:var(--shadow-md);opacity:0;visibility:hidden;pointer-events:none;z-index:5;transition:opacity var(--duration-fast) var(--ease-standard),transform var(--duration-fast) var(--ease-standard)}
.daytip::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--slate-900)}
.weekday:hover .daytip{opacity:1;visibility:visible;transform:translate(-50%,0)}
/* Крайние столбцы — якорим подсказку внутрь, иначе на мобиле она уедет за край. */
.dash-week-dots .weekday:first-child .daytip{left:0;transform:translate(0,4px)}
.dash-week-dots .weekday:first-child:hover .daytip{transform:translate(0,0)}
.dash-week-dots .weekday:first-child .daytip::after{left:14px}
.dash-week-dots .weekday:last-child .daytip{left:auto;right:0;transform:translate(0,4px)}
.dash-week-dots .weekday:last-child:hover .daytip{transform:translate(0,0)}
.dash-week-dots .weekday:last-child .daytip::after{left:auto;right:14px}
.weekday:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:9px}
.weekday:focus-visible .daytip{opacity:1;visibility:visible;transform:translate(-50%,0)}
.dash-week-dots .weekday:first-child:focus-visible .daytip{transform:translate(0,0)}
.dash-week-dots .weekday:last-child:focus-visible .daytip{transform:translate(0,0)}
.dash-bandnum-wrap{position:relative;display:inline-flex;cursor:help}
.dash-bandnum-wrap:hover .daytip,.dash-bandnum-wrap:focus-visible .daytip{opacity:1;visibility:visible;transform:translate(-50%,0)}
.dash-bandnum-wrap:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:8px}
@media (min-width:768px){
  .dash-wrap{padding:32px 28px 56px}
  .dash-hi{font-size:32px;white-space:nowrap}
  .dash-focus-title{font-size:42px}
  .dash-band-num{font-size:60px}
  .dash-band{flex-direction:row;align-items:center;gap:32px}
  .dash-focus{padding:38px}
  .dash-sect{padding:28px 30px}
  .dash-sect-tight{padding:22px 30px 12px}
  .dash-week{padding:14px 22px}
  .dash-week-row{flex-direction:row;align-items:center;gap:18px 22px;flex-wrap:wrap}
  .dash-week-dots{flex:1;width:auto;min-width:170px;max-width:300px}
  .dash-week-cta{width:auto;margin-left:auto}
}
@media (min-width:1024px){
  .dash-wrap{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:18px;align-items:start}
  .dash-grid-span{grid-column:1 / -1}
  /* В узкой правой колонке (1fr) карточка тесная — сбрасываем tablet-раскладку
     ряда (width:auto;margin-left:auto), где cta размерится по контенту и
     вылезает. Пин к 100% даёт кнопке жёсткую ширину, и label обрезается. */
  .dash-week-cta{width:100%;margin-left:0}
}
/* Узкие телефоны (≤430px): значок+заголовок не помещаются в один ряд с band/chip/score
   → разрешаем перенос хвоста (badge/chip/score) на вторую строку вместо клиппинга. */
@media (max-width:430px){
  .dash-trow{flex-wrap:wrap}
  .dash-trow-tail{flex:1 1 100%;justify-content:flex-end}
  /* Мелкий текст трудно читать на телефоне: чип дельты и буква дня недели —
     смысловые лейблы, поднимаем до 12px (правило микро-текста батча F). */
  .dash-chip{font-size:12px!important}
  .dash-week-lab{font-size:12px!important}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1180, margin: "0 auto" },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-sm)",
  },

  greet: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 },
  // Стат-лейбл (sentence case) — намеренно тише brand-eyebrow приветствия, чтобы
  // надзаголовок не повторялся как один и тот же AI-каданс на каждой секции.
  bandLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)" },
  hi: { fontFamily: "var(--font-ui)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "8px 0 0" },
  date: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", paddingBottom: 4 },

  /* Focus hero */
  focus: {
    borderRadius: "var(--radius-xl)",
    position: "relative",
    overflow: "hidden",
    // Затемнён до brand-active→deeper: светлейший стоп = violet-700, чтобы белый
    // ink-текст (вкл. body@0.85 / eyebrow@0.92) держал WCAG AA (5.0–5.3:1).
    // Ambient highlight in the text-free top-right corner (replaces the old
    // 3-bar mark that read as skeleton loaders). Kept off the ink so the hero's
    // computed AA on white text is unaffected.
    background: "radial-gradient(620px 420px at 92% -12%, rgba(255,255,255,0.13), transparent 58%), linear-gradient(150deg, var(--brand-active), color-mix(in oklab, var(--brand-active) 78%, black))",
    boxShadow: "var(--shadow-md)",
    display: "flex",
    flexDirection: "column",
  },
  focusInner: { position: "relative", display: "flex", flexDirection: "column", height: "100%" },
  focusEyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    color: "rgba(255,255,255,0.92)",
  },
  focusTitle: { fontFamily: "var(--font-ui)", fontWeight: 900, letterSpacing: "var(--tracking-tighter)", color: "#fff", margin: "14px 0 0", textWrap: "balance" },
  focusText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", lineHeight: 1.55, color: "rgba(255,255,255,0.85)", margin: "11px 0 0", maxWidth: 420, textWrap: "pretty" },
  focusTrack: { height: 10, borderRadius: "var(--radius-full)", background: "rgba(255,255,255,0.25)", overflow: "hidden", maxWidth: 380 },
  focusFill: { height: "100%", background: "#fff", borderRadius: "var(--radius-full)" },
  // Accuracy-ридаут в hero: тихий caps-лейбл + крупная mono-цифра (фирменный знак
  // «цифры = mono») — контраст веса, и число выносит data из прозы (тон прозы тёплый).
  focusProgHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", maxWidth: 380, marginBottom: 8 },
  focusProgLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 800, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "rgba(255,255,255,0.85)" },
  focusProgVal: { fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", fontWeight: 600, color: "#fff" },
  focusCta: { marginTop: "auto", paddingTop: 26 },
  focusPills: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 },
  focusPill: { display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: "var(--text-xs)", fontWeight: 700, borderRadius: "var(--radius-full)", padding: "5px 12px" },
  spark: { display: "inline-flex", gap: 3, alignItems: "flex-end", height: 22 },
  sparkBar: { width: 6, height: 8, borderRadius: 2, background: "rgba(255,255,255,0.4)", display: "block" },
  sparkHint: { fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.8)", fontWeight: 600, fontFamily: "var(--font-ui)" },

  /* This week — momentum-полоса (segments: stats | dots | league | cta) */
  weekStats: { display: "flex", alignItems: "center", gap: 14, flex: "none" },
  flameIc: { width: 46, height: 46, flex: "none", borderRadius: 14, display: "grid", placeItems: "center", background: "color-mix(in oklab, var(--streak) 15%, var(--surface))", color: "var(--streak)" },
  flameNum: { fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.02em" },
  flameSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)", marginTop: 3 },
  weekLab: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", fontWeight: 600 },
  weekLeague: { display: "flex", alignItems: "center", gap: 10, flex: "none", textDecoration: "none", color: "inherit", padding: "8px 12px", borderRadius: "var(--radius-md)", background: "var(--surface-inset)" },
  leagueIcSm: { width: 32, height: 32, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  leagueName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-secondary)" },
  leagueRank: { fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text-primary)" },
  leagueTotal: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", fontWeight: 600 },
  leagueRating: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand)", background: "var(--brand-subtle)", borderRadius: "var(--radius-full)", padding: "3px 9px" },
  leagueHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--brand-active)" },

  /* Vocabulary rail card */
  vocabCard: { padding: 18, display: "flex", flexDirection: "column", gap: 12 },
  vocabTop: { display: "flex", alignItems: "center", gap: 10 },
  vocabIc: { width: 38, height: 38, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  vocabTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)" },
  vocabLine: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)", marginTop: 2 },
  vocabNum: { fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)" },
  vocabText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.5, color: "var(--text-muted)", margin: 0 },
  vocabBadges: { display: "flex", gap: 8, flexWrap: "wrap" },
  vocabBadgeStreak: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--streak)", background: "var(--streak-subtle)", borderRadius: "var(--radius-full)", padding: "4px 10px" },
  vocabBadgeGoal: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", background: "var(--surface-inset)", borderRadius: "var(--radius-full)", padding: "4px 10px" },
  vocabCta: { alignSelf: "flex-start" },

  /* Plan-to-target rail card */
  planCard: { padding: 18, display: "flex", flexDirection: "column", gap: 10 },
  planTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)" },
  planText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.5, color: "var(--text-muted)", margin: 0 },
  planDistance: { fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)", fontSize: "var(--text-md)" },
  planDrill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    color: "var(--brand-active)",
    textDecoration: "none",
    background: "var(--brand-subtle)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
  },

  /* Band readout */
  bandCard: { padding: "24px 28px" },
  // Headline-метрика приподнята над рядом «плоских» карточек: ambient shadow-md +
  // brand-рамка — presence без «нажимаемого» solid-канта (band-ридаут не кликабелен).
  // ТОЛЬКО в заполненном состоянии (пустой band остаётся тихим, см. bandEmptyNum).
  bandCardFilled: { boxShadow: "var(--shadow-md)", borderColor: "var(--brand-border)" },
  bandNum: { fontFamily: "var(--font-mono)", lineHeight: 1, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" },
  bandTarget: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-muted)" },
  // Пустое состояние band: absence намеренно тихая (34px, не 56px) — disabled-«—»
  // не должно быть одним из крупнейших элементов экрана и читаться как «сломано».
  bandEmptyNum: { fontFamily: "var(--font-mono)", fontSize: 34, lineHeight: 1, fontWeight: 600, color: "var(--text-disabled)", letterSpacing: "-0.02em", marginTop: 8 },
  bandEmptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", lineHeight: 1.5, color: "var(--text-muted)", margin: 0, maxWidth: 460 },
  // Шкала band — гридлайны по целым (0…9) поверх трека: slim-бар читается как
  // измерительная шкала IELTS, а не безымянный progress (committed density).
  bandScale: { position: "relative", height: 14, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", backgroundImage: "repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 9 - 1px), var(--border) calc(100% / 9 - 1px), var(--border) calc(100% / 9))" },
  bandFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "linear-gradient(90deg, var(--brand-active), var(--brand))" },
  bandTick: { position: "absolute", top: -6, width: 4, height: 26, borderRadius: 3, background: "var(--text-primary)" },
  bandTickMile: { position: "absolute", top: -4, width: 4, height: 22, borderRadius: 3, background: "var(--brand)" },
  bandLegend: { display: "flex", justifyContent: "space-between", marginTop: 9, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  /* Sections */
  sectionTitle: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xl)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-tight)",
    color: "var(--text-primary)",
    margin: 0,
    whiteSpace: "nowrap",
  },
  drillAny: { marginLeft: "auto", color: "var(--brand-active)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" },
  lossLead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "2px 0 12px" },
  leadStrong: { color: "var(--text-secondary)", fontWeight: 700 },
  // Тёплая строка нормализации (full-bg тинт, без side-stripe) — только при низком
  // старте: candid-секция остаётся, но не бьёт ученика без поддержки.
  lossNorm: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-md)", padding: "10px 14px", margin: "0 0 14px", lineHeight: 1.5 },

  /* Loss spine */
  loss: { display: "flex", alignItems: "center", gap: 16, padding: "13px 0", borderTop: "1px solid var(--border-subtle)", textDecoration: "none", color: "inherit" },
  lossRank: { width: 26, height: 26, flex: "none", borderRadius: 8, display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, background: "var(--surface-inset)", color: "var(--text-muted)" },
  lossRankWorst: { background: "var(--error-subtle)", color: "var(--error-text)" },
  lossName: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  lossTrack: { height: 9, background: "var(--surface-inset)", borderRadius: "var(--radius-full)", overflow: "hidden", marginTop: 8 },
  lossScore: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", minWidth: 46, textAlign: "right" },
  // Нейтральная пилюля (не красно-залитая): единственный красный акцент в списке —
  // ранг худшей строки (lossRankWorst), а не каскад из пяти красных пятен.
  lossPts: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", background: "var(--surface-inset)", borderRadius: "var(--radius-full)", padding: "4px 9px", minWidth: 58, textAlign: "center" },
  moreSummary: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "13px 0 2px", borderTop: "1px solid var(--border-subtle)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--brand-active)" },

  /* Recent tests */
  trow: { display: "flex", alignItems: "center", gap: 14, padding: "15px 0", borderBottom: "1px solid var(--border-subtle)", textDecoration: "none", color: "inherit" },
  trowIc: { width: 40, height: 40, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  trowIcR: { background: "var(--warn-subtle)", color: "var(--warn-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800 },
  trowIcL: { background: "var(--success-subtle)", color: "var(--success-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800 },
  trowTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  trowMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 },
  trowScore: { fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)", minWidth: 64, textAlign: "right" },
  chip: { fontSize: "var(--text-2xs)", fontWeight: 800, borderRadius: 7, padding: "3px 8px", flex: "none", fontFamily: "var(--font-ui)" },
  chipWeak: { background: "var(--error-subtle)", color: "var(--error-text)" },
  chipUp: { background: "var(--success-subtle)", color: "var(--success-text)" },
  chipRev: { background: "var(--surface-inset)", color: "var(--text-muted)" },

  empty: {
    padding: "1.5rem 0 2rem",
    textAlign: "center",
    color: "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
  },
};
