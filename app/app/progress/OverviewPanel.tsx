import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireUser, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { db } from "@/db";
import { leaderboardEntry } from "@/db/schema";
import { LISTENING_CATEGORIES } from "@/lib/labels";
import {
  buildTrajectory,
  computeForecast,
  buildReadiness,
  type Trajectory,
  type TrajectoryPoint,
  type Forecast,
  type Readiness,
  type SkillReadiness,
  type Skill,
} from "@/lib/progress/overview";
import { computeStats, badgeProgress, type Criteria } from "@/lib/progress/badges";
import { getActiveBadges, type ActiveBadge } from "@/lib/content/badges";
import { listUserHistory as listWritingHistory } from "@/lib/writing/read";
import { listUserHistory as listSpeakingHistory } from "@/lib/speaking/read";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
import { OverviewMotion } from "./OverviewMotion";
import { ProgressTabs } from "./ProgressTabs";
import { TrajectoryChart } from "./TrajectoryChart";

const DAY_MS = 86_400_000;

interface AttemptRow {
  band_score: string | null;
  submitted_at: string | null;
  content_item: { category: string } | null;
}

/**
 * Overview — единый якорь раздела Progress. Герой «Траектория» и «Прогноз» слиты
 * в ОДНУ карту-якорь (band-график + headline-число прогноза сверху + detail-полоса
 * снизу), под ней — поддерживающий ряд Readiness + превью League/Badges. Раздел
 * несёт общую «арену» (радиальный brand-wash), тот же фон, что и League/Badges, —
 * это визуальный клей всех трёх табов. Вычислительное ядро (Trajectory/Forecast/
 * Readiness) — src/lib/progress/overview.ts; здесь только owner-путь чтения и рендер.
 * Один Promise.all — R/L из RLS-scoped supabase, W/S band из owner-путей writing/read
 * и speaking/read, лига/бейджи — тем же способом, что дашборд/BadgesPanel.
 */
export async function OverviewPanel() {
  const user = await requireUser();
  const supabase = await createClient();
  // Пре-варм данных шапки конкурентно с телом панели (cache()'d; AppShell reuses).
  void getHeaderData();

  const [
    profile,
    attemptsRes,
    writingHistory,
    speakingHistory,
    rankRows,
    stats,
    badges,
    { data: earnedData },
  ] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select("band_score,submitted_at,content_item:content_item_id(category)")
      .eq("status", "submitted")
      .not("band_score", "is", null)
      // Нужны САМЫЕ СВЕЖИЕ 100 попыток (прогноз/readiness смотрят на хвост
      // истории), не самые старые — сортировка по убыванию перед limit;
      // buildTrajectory сам пересортирует в хронологический порядок.
      .order("submitted_at", { ascending: false })
      .limit(100),
    listWritingHistory(user.id, 1),
    listSpeakingHistory(user.id, 1),
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
    computeStats(user.id),
    getActiveBadges(),
    supabase.from("user_badge").select("badge_id").eq("user_id", user.id),
  ]);

  // RLS/сетевой сбой не должен молча выглядеть как «попыток нет» — пробрасываем
  // с контекстом запроса вместо тихого fallback на пустой массив.
  if (attemptsRes.error) {
    throw new Error(`OverviewPanel: attempt query failed — ${attemptsRes.error.message}`);
  }
  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];
  const listeningCats = new Set<string>(LISTENING_CATEGORIES);

  const trajectory = buildTrajectory(
    attempts.map((a) => ({
      bandScore: a.band_score != null ? Number(a.band_score) : null,
      section: listeningCats.has(a.content_item?.category ?? "") ? "listening" : "reading",
      submittedAt: a.submitted_at,
    })),
  );

  const targetBand = profile?.target_band != null ? Number(profile.target_band) : null;
  const examDate = (profile?.exam_date as string | null) ?? null;

  // Ядро прогноза рассчитано на окно ≤20 последних точек — полную историю
  // подаём только на график (trajectory.combined ниже, в AnchorHero).
  const forecast = computeForecast(trajectory.combined.slice(-20), examDate, targetBand);

  const lastBand = (pts: TrajectoryPoint[]) => (pts.length ? pts[pts.length - 1].band : null);
  const writingBand = writingHistory[0] ? (writingHistory[0].bandLow + writingHistory[0].bandHigh) / 2 : null;
  const speakingBand = speakingHistory[0] ? (speakingHistory[0].bandLow + speakingHistory[0].bandHigh) / 2 : null;

  const readiness = buildReadiness({
    reading: lastBand(trajectory.reading),
    listening: lastBand(trajectory.listening),
    writing: writingBand,
    speaking: speakingBand,
    targetBand,
  });

  const rank = rankRows[0]?.rank ?? null;

  const earnedIds = new Set(((earnedData ?? []) as { badge_id: string }[]).map((r) => r.badge_id));
  const earnedTotal = badges.filter((b) => earnedIds.has(b.id)).length;
  const nextBadge = badges
    .filter((b): b is ActiveBadge & { criteria: Criteria } => !earnedIds.has(b.id) && b.criteria != null)
    .map((b) => ({ badge: b, prog: badgeProgress(b.criteria, stats) }))
    .sort((a, b) => b.prog.pct - a.prog.pct)[0] ?? null;

  return (
    <AppShell active="progress">
      <style>{OV_CSS}</style>
      <div data-overview-root className="ov-arena">
        <div className="ov-wrap" style={S.wrap}>
          <ProgressTabs tab="overview" />
          <header style={S.head}>
            <span style={S.headIcon}>
              <Icon name="bar-chart" size={21} strokeWidth={2.3} style={{ color: "var(--text-on-brand)" }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={S.h1}>Overview</h1>
              <p style={S.sub}>Your band trajectory, forecast, and readiness in one place.</p>
            </div>
          </header>

          <AnchorHero trajectory={trajectory} forecast={forecast} targetBand={targetBand} examDate={examDate} />

          <div className="ov-grid">
            <ReadinessCard readiness={readiness} />
            <div className="ov-previews">
              <LeaguePreview rank={rank} />
              <BadgesPreview earned={earnedTotal} total={badges.length} next={nextBadge} />
            </div>
          </div>
        </div>
      </div>
      <OverviewMotion />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Anchor hero — trajectory chart + forecast headline fused into one surface.  */
/* Server computes ALL SVG geometry; the client island (OverviewMotion) only   */
/* layers draw-in / fade / count-up motion on top, and TrajectoryChart adds    */
/* the hover crosshair + tooltip. The chart stays on a light surface so its    */
/* WCAG-tuned grid/target/series contrast is preserved; the "committed" brand  */
/* moment lives in the hero's top band only.                                   */
/* -------------------------------------------------------------------------- */

const CHART_W = 680;
const CHART_H = 230;
const PAD_L = 32;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 24;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

interface Scaled {
  x: number;
  y: number;
}

function scalePoints(pts: TrajectoryPoint[], xScale: (t: number) => number, yScale: (b: number) => number): Scaled[] {
  return pts.map((p) => ({ x: xScale(p.t), y: yScale(p.band) }));
}

function polylineLength(pts: Scaled[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function pointsAttr(pts: Scaled[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function AnchorHero({
  trajectory,
  forecast,
  targetBand,
  examDate,
}: {
  trajectory: Trajectory;
  forecast: Forecast;
  targetBand: number | null;
  examDate: string | null;
}) {
  const pts = trajectory.combined;

  // Empty — no mocks yet. The hero is the invitation to start the trajectory.
  if (pts.length === 0) {
    return (
      <div className="ov-hero" style={S.hero}>
        <div style={S.heroEmpty}>
          <div style={S.heroEmptyIcon}>
            <Icon name="bar-chart" size={26} strokeWidth={2.2} />
          </div>
          <h2 style={S.heroEmptyTitle}>Sit your first full mock to start your trajectory</h2>
          <p style={S.heroEmptyText}>
            Band scores come from full 40-question mocks. Once you&apos;ve sat one, your line starts here.
          </p>
          <Button trailingIcon="arrow-right" href="/app/reading?category=full_reading" style={{ marginTop: 4 }}>
            Sit a full mock
          </Button>
        </div>
      </div>
    );
  }

  // Y domain always spans the practical band range [4,9], widened to fit any
  // outlier (history) or forecast figure that falls outside it.
  const bandValues = pts.map((p) => p.band);
  if (forecast.projectedBand != null) bandValues.push(forecast.projectedBand);
  if (forecast.interval) bandValues.push(forecast.interval.low, forecast.interval.high);
  const yMin = Math.floor(Math.min(4, ...bandValues) * 2) / 2;
  const yMax = Math.ceil(Math.max(9, ...bandValues) * 2) / 2;

  // X domain: full point history, widened to the forecast horizon and/or the
  // exam date when either falls beyond the last real point in EITHER direction
  // (an exam date can in principle sit before the first history point).
  let xMin = pts[0].t;
  let xMax = pts[pts.length - 1].t;
  if (forecast.horizonDate) xMax = Math.max(xMax, Date.parse(`${forecast.horizonDate}T00:00:00Z`));
  const examMs = examDate ? Date.parse(`${examDate}T00:00:00Z`) : NaN;
  const examInRange = Number.isFinite(examMs) && examMs > Date.now();
  if (examInRange) {
    xMin = Math.min(xMin, examMs);
    xMax = Math.max(xMax, examMs);
  }
  if (xMin === xMax) {
    xMin -= 7 * DAY_MS;
    xMax += 7 * DAY_MS;
  }

  const xScale = (t: number) => PAD_L + ((t - xMin) / (xMax - xMin)) * PLOT_W;
  const yScale = (b: number) => PAD_T + (1 - (b - yMin) / (yMax - yMin)) * PLOT_H;

  const combinedPts = scalePoints(pts, xScale, yScale);
  const combinedLen = polylineLength(combinedPts);
  const readingPts = trajectory.reading.length >= 2 ? scalePoints(trajectory.reading, xScale, yScale) : null;
  const listeningPts = trajectory.listening.length >= 2 ? scalePoints(trajectory.listening, xScale, yScale) : null;

  const gridBands: number[] = [];
  for (let b = Math.ceil(yMin); b <= Math.floor(yMax); b++) gridBands.push(b);

  const targetY = targetBand != null ? yScale(Math.min(Math.max(targetBand, yMin), yMax)) : null;
  const examX = examInRange ? xScale(examMs) : null;

  const last = pts[pts.length - 1];
  const lastScaled = combinedPts[combinedPts.length - 1];

  // Forecast cone/tail — only once the core has enough points to project.
  const showForecast = forecast.status !== "insufficient" && forecast.projectedBand != null && forecast.interval && forecast.horizonDate;
  const horizonX = showForecast ? xScale(Date.parse(`${forecast.horizonDate}T00:00:00Z`)) : null;
  const projY = showForecast ? yScale(forecast.projectedBand!) : null;
  const lowY = showForecast ? yScale(forecast.interval!.low) : null;
  const highY = showForecast ? yScale(forecast.interval!.high) : null;

  // Геометрия готова — передаём в клиентский график плоскими числами/строками.
  // Он рисует тот же SVG (SSR-идентично) и добавляет визир + hover-подсказку.
  const combined = pts.map((p, i) => ({
    x: combinedPts[i].x,
    y: combinedPts[i].y,
    band: p.band,
    dateMs: p.t,
    section: p.section,
  }));

  return (
    <div className="ov-hero" style={S.hero}>
      <HeroBand forecast={forecast} targetBand={targetBand} latest={last.band} count={pts.length} />

      <div className="ov-hero-chart">
        <TrajectoryChart
          w={CHART_W}
          h={CHART_H}
          padL={PAD_L}
          padR={PAD_R}
          padT={PAD_T}
          padB={PAD_B}
          combined={combined}
          combinedAttr={pointsAttr(combinedPts)}
          combinedLen={Number(combinedLen.toFixed(1))}
          reading={readingPts ? { attr: pointsAttr(readingPts), len: Number(polylineLength(readingPts).toFixed(1)) } : null}
          listening={listeningPts ? { attr: pointsAttr(listeningPts), len: Number(polylineLength(listeningPts).toFixed(1)) } : null}
          grid={gridBands.map((b) => ({ band: b, y: yScale(b) }))}
          target={targetY != null ? { y: targetY, band: targetBand! } : null}
          exam={examX != null ? { x: examX, rightEdge: examX > CHART_W - PAD_R - 28 } : null}
          forecast={showForecast ? { lastX: lastScaled.x, lastY: lastScaled.y, horizonX: horizonX!, projY: projY!, lowY: lowY!, highY: highY! } : null}
          xLabelLeft={fmtDate(xMin)}
          xLabelRight={fmtDate(xMax)}
          latestBand={last.band}
        />
      </div>

      <ForecastStrip forecast={forecast} />
    </div>
  );
}

/* Hero band — the forecast headline. State-driven: a projected band once the
   core can project, otherwise an unlock track toward the first forecast. The
   latest-band chip anchors the right on every non-empty state. */
function HeroBand({
  forecast,
  targetBand,
  latest,
  count,
}: {
  forecast: Forecast;
  targetBand: number | null;
  latest: number;
  count: number;
}) {
  const eyebrow = targetBand != null ? `Your run at Band ${targetBand}` : "Your band forecast";
  const chip = (
    <div style={S.heroChip}>
      <span style={S.heroChipLabel}>Latest</span>
      <span style={S.heroChipVal}>{latest.toFixed(1)}</span>
      <span style={S.heroChipMeta}>· {count} {count === 1 ? "mock" : "mocks"}</span>
    </div>
  );

  if (forecast.status === "insufficient") {
    const done = Math.min(forecast.pointCount, 3);
    const remaining = Math.max(0, 3 - forecast.pointCount);
    return (
      <div className="ov-hero-band" style={S.heroBand}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.heroEyebrow}>Forecast</div>
          <div style={S.heroHeadline}>
            {remaining === 0
              ? "Crunching your first projection"
              : `${remaining} more full ${remaining === 1 ? "mock" : "mocks"} to unlock your forecast`}
          </div>
          <div style={S.unlockRow} role="img" aria-label={`${done} of 3 mocks toward your first forecast`}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ ...S.unlockPip, ...(i < done ? S.unlockPipOn : null) }} />
            ))}
            <span style={S.unlockMeta}>{done}/3 mocks</span>
          </div>
        </div>
        {chip}
      </div>
    );
  }

  const verdict = forecast.verdict;
  const verdictText: Record<typeof verdict, string> = {
    reached: "Target reached — you're already there \u{1F3AF}",
    on_track: `On track for band ${forecast.targetBand} by ${forecast.horizonDate ? fmtDate(Date.parse(`${forecast.horizonDate}T00:00:00Z`)) : "exam day"}`,
    behind: `Behind pace for band ${forecast.targetBand} — more practice closes the gap`,
    no_target: "No target band set yet — add one to see if you're on pace",
    insufficient: "",
  };
  const verdictStyle = verdict === "reached" || verdict === "on_track" ? S.verdictGood : verdict === "behind" ? S.verdictWarn : S.verdictNeutral;

  return (
    <div className="ov-hero-band" style={S.heroBand}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.heroEyebrow}>{eyebrow}</div>
        <div style={S.forecastRow}>
          {/* Цвет числа отражает вердикт: brand-акцент для reached/on_track, нейтральный
              ink для behind — праздничный фиолетовый под отстающим прогнозом вводил в
              заблуждение. Число статично (не count-up с нуля): точный чувствительный
              band «просто верен», а не отсчитывается ради эффекта. */}
          <span style={{ ...S.forecastBig, color: verdict === "behind" ? "var(--text-primary)" : "var(--brand)" }}>
            {forecast.status === "low_confidence" && <span style={S.forecastApprox}>~</span>}
            <span>{forecast.projectedBand?.toFixed(1)}</span>
          </span>
          <span style={S.forecastUnit}>projected band</span>
        </div>
        {verdictText[verdict] && <div style={{ ...verdictStyle, marginTop: 12 }}>{verdictText[verdict]}</div>}
      </div>
      {chip}
    </div>
  );
}

/* Forecast detail strip — the methodology that used to live in the Forecast
   card, demoted below the chart: the likely range, what it's built on, and
   recent pace. Non-native audience needs "likely range" spelled out. */
function ForecastStrip({ forecast }: { forecast: Forecast }) {
  if (forecast.status === "insufficient") return null;

  const items: React.ReactNode[] = [];
  if (forecast.interval) {
    items.push(
      <span key="range">
        <b style={S.stripB}>
          {forecast.interval.low.toFixed(1)}–{forecast.interval.high.toFixed(1)}
        </b>{" "}
        likely by {forecast.horizonDate ? fmtDate(Date.parse(`${forecast.horizonDate}T00:00:00Z`)) : "then"}
      </span>,
    );
    items.push(
      <span key="basis">
        the 80% range from your last {forecast.pointCount} {forecast.pointCount === 1 ? "mock" : "mocks"} — narrows as you sit more
      </span>,
    );
  }
  if (forecast.slopePerWeek != null && forecast.slopePerWeek > 0) {
    items.push(
      <span key="pace">
        improving <b style={S.stripB}>~{forecast.slopePerWeek.toFixed(2)}</b> band/week lately
      </span>,
    );
  }
  if (forecast.status === "low_confidence") {
    items.push(
      <span key="conf" style={{ color: "var(--text-muted)" }}>
        early estimate — confidence grows as you sit more
      </span>,
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="ov-hero-strip">
      {items.map((node, i) => (
        <span key={i} style={S.stripItem}>
          {i > 0 && <span aria-hidden="true" style={S.stripDot} />}
          {node}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Readiness card                                                             */
/* -------------------------------------------------------------------------- */

const SKILL_META: Record<Skill, { label: string; icon: IconName; href: string }> = {
  reading: { label: "Reading", icon: "book-open", href: "/app/reading" },
  listening: { label: "Listening", icon: "headphones", href: "/app/listening" },
  writing: { label: "Writing", icon: "pen-line", href: "/app/writing" },
  speaking: { label: "Speaking", icon: "mic", href: "/app/speaking" },
};

function ReadinessCard({ readiness }: { readiness: Readiness }) {
  const started = readiness.skills.filter((s) => s.band != null).length;
  return (
    <div style={S.card}>
      <div style={S.readyHead}>
        <h2 style={S.sectionTitle}>Readiness</h2>
        <span style={S.readyCount}>{started}/4 skills</span>
      </div>
      {started === 0 && (
        <p style={S.readySub}>Four skills, one target. Sit any test to light up its bar.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        {readiness.skills.map((s) => (
          <ReadinessRow key={s.skill} s={s} targetBand={readiness.targetBand} />
        ))}
      </div>
    </div>
  );
}

function ReadinessRow({ s, targetBand }: { s: SkillReadiness; targetBand: number | null }) {
  const meta = SKILL_META[s.skill];
  const tickPct = targetBand != null ? Math.max(0, Math.min(100, (targetBand / 9) * 100)) : null;

  // Пустой скилл — не «No data yet», а тихий goal-трек: приглушённый лейбл,
  // призрачная дорожка с тиком цели и тонкий «Start». Вся строка — ссылка,
  // одна affordance вместо повторяющегося текста + отдельной CTA.
  if (s.band == null) {
    return (
      <Link data-row href={meta.href} style={{ ...S.readyRow, textDecoration: "none" }}>
        <span style={{ ...S.readyIcon, ...S.readyIconGhost }}>
          <Icon name={meta.icon} size={16} strokeWidth={2.2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.readyLabelRow}>
            <span style={{ ...S.readyLabel, color: "var(--text-secondary)" }}>{meta.label}</span>
            <span style={S.readyStart}>Start →</span>
          </div>
          <div style={S.readyTrack}>
            {tickPct != null && <span aria-hidden="true" style={{ ...S.readyTick, left: `${tickPct}%` }} />}
          </div>
        </div>
      </Link>
    );
  }

  const pct = Math.max(0, Math.min(100, (s.band / 9) * 100));

  return (
    <div data-row style={S.readyRow}>
      <span style={S.readyIcon}>
        <Icon name={meta.icon} size={16} strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.readyLabelRow}>
          <span style={S.readyLabel}>{meta.label}</span>
          <span style={S.readyBand}>
            {s.band.toFixed(1)}
            {s.met && (
              <span style={{ color: "var(--success-text)", marginLeft: 5 }}>
                <Icon name="circle-check" size={13} strokeWidth={2.4} />
              </span>
            )}
          </span>
        </div>
        <div style={S.readyTrack}>
          <div data-grow style={{ ...S.readyFill, width: `${pct}%` }} />
          {tickPct != null && <span aria-hidden="true" style={{ ...S.readyTick, left: `${tickPct}%` }} />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* League / Badges preview cards                                              */
/* -------------------------------------------------------------------------- */

function LeaguePreview({ rank }: { rank: number | null }) {
  return (
    <Link href="/app/progress?tab=league" className="ov-preview" style={S.previewCard}>
      <span style={{ ...S.previewIcon, background: "linear-gradient(165deg, var(--brand), var(--brand-active))" }}>
        <Icon name="crown" size={20} strokeWidth={2.2} style={{ color: "var(--text-on-brand)" }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.previewLabel}>League</div>
        <div style={S.previewValue}>{rank != null ? `#${rank}` : "Not ranked"}</div>
      </div>
      <Icon name="chevron-right" size={17} strokeWidth={2.2} style={{ color: "var(--text-disabled)", flex: "none" }} />
    </Link>
  );
}

function BadgesPreview({
  earned,
  total,
  next,
}: {
  earned: number;
  total: number;
  next: { badge: ActiveBadge; prog: { pct: number; hint: string } } | null;
}) {
  return (
    <Link href="/app/progress?tab=badges" className="ov-preview" style={S.previewCard}>
      <span style={{ ...S.previewIcon, background: "linear-gradient(165deg, var(--surface-inverse), var(--surface-inverse-deep))" }}>
        <Icon name="award" size={20} strokeWidth={2.2} style={{ color: "var(--surface-inverse-ink)" }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.previewLabel}>Badges</div>
        <div style={S.previewValue}>
          {earned}/{total}
          {next && <span style={S.previewHint}> · next: {next.badge.name}</span>}
        </div>
      </div>
      <Icon name="chevron-right" size={17} strokeWidth={2.2} style={{ color: "var(--text-disabled)", flex: "none" }} />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

// Адаптив Overview. База = мобильный (стек); ≥768px = поддерживающий ряд в две
// колонки. Брейкпоинт-свойства только в классах. Классы графика/легенды/тултипа
// (.ov-chart*, .ov-tip*, .ov-lbl*, .ov-leg*) потребляются клиентским
// TrajectoryChart — держим их verbatim.
const OV_CSS = `
.ov-arena{min-height:100%;overflow-x:hidden;background:radial-gradient(120% 80% at 50% -8%, color-mix(in oklab, var(--brand) 13%, white) 0%, var(--bg-base) 52%)}
.ov-wrap{padding:22px 16px 40px}
.ov-grid{display:grid;grid-template-columns:1fr;gap:14px}
.ov-previews{display:flex;flex-direction:column;gap:12px}
.ov-hero-band{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px;padding:20px 22px 18px;background:linear-gradient(160deg, color-mix(in oklab, var(--brand) 12%, var(--surface)) 0%, var(--surface) 62%);border-bottom:1px solid var(--border-subtle)}
.ov-hero-chart{padding:16px 18px 4px}
.ov-hero-strip{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;padding:12px 20px 16px;font-family:var(--font-ui);font-size:var(--text-2xs);color:var(--text-secondary);line-height:1.5}
.ov-preview{transition:transform .12s,box-shadow .12s}
.ov-preview:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.ov-preview:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--brand) 45%,transparent)}
.ov-chart{position:relative}
.ov-chart-svg:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--brand) 40%,transparent);border-radius:var(--radius-md)}
.ov-cross{transition:opacity .1s}
.ov-tip{position:absolute;z-index:5;pointer-events:none;background:var(--surface-inverse);color:var(--surface-inverse-ink);border-radius:10px;padding:8px 11px;box-shadow:var(--shadow-lg);white-space:nowrap;font-family:var(--font-ui)}
.ov-tip::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--surface-inverse)}
.ov-tip-left::after{left:16px;transform:none}
.ov-tip-right::after{left:auto;right:16px;transform:none}
.ov-tip-below::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:var(--surface-inverse)}
.ov-tip-date{font-size:var(--text-2xs);color:color-mix(in oklab,var(--surface-inverse-ink) 68%,transparent);margin-bottom:3px}
.ov-tip-band{font-size:var(--text-sm);font-weight:600;display:flex;align-items:center;gap:6px}
.ov-tip-band b{font-family:var(--font-mono);font-weight:700}
.ov-tip-dot{width:8px;height:8px;border-radius:50%;flex:none}
.ov-tip-delta{font-size:var(--text-2xs);font-weight:700;font-family:var(--font-mono);margin-top:3px}
.ov-labels{position:absolute;inset:0;pointer-events:none;font-family:var(--font-ui)}
.ov-lbl{position:absolute;font-size:var(--text-2xs);line-height:1;white-space:nowrap}
.ov-lbl-grid{font-family:var(--font-mono);color:var(--text-muted);transform:translate(-100%,-50%)}
.ov-lbl-target{color:var(--warn-text);font-weight:700;transform:translate(-100%,-135%)}
.ov-lbl-exam{color:var(--brand-active);font-weight:700}
.ov-lbl-latest{font-family:var(--font-mono);font-weight:700;color:var(--text-primary);transform:translate(calc(-100% - 8px),-120%)}
.ov-lbl-axis{color:var(--text-muted)}
.ov-lbl-axis-r{transform:translate(-100%,0)}
.ov-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.ov-leg-item{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:600}
.ov-leg-static{color:var(--text-secondary);padding:3px 2px}
/* R/L — bordered pill: явный контрол на тач, где нет hover. Off-состояние держит
   ТЕКСТ на --text-muted (≈4.9:1, AA), а состояние несёт пунктирная рамка +
   strikethrough + приглушённый свотч — без opacity на самом тексте (та давала ~1.5:1). */
.ov-leg-btn{color:var(--text-secondary);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-full);padding:3px 10px;cursor:pointer;transition:background .12s,border-color .12s}
.ov-leg-btn:hover{background:var(--surface-inset)}
.ov-leg-btn[aria-pressed="false"]{color:var(--text-muted);border-style:dashed;text-decoration:line-through}
.ov-leg-btn[aria-pressed="false"] .ov-leg-swatch{opacity:.4}
.ov-leg-btn:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--brand) 40%,transparent)}
.ov-leg-swatch{flex:none}
.ov-leg-line{width:14px;height:3px;border-radius:var(--radius-full)}
.ov-leg-circle{width:9px;height:9px;border-radius:50%}
.ov-leg-diamond{width:9px;height:9px;border-radius:2px;transform:rotate(45deg)}
.ov-legend-note{font-family:var(--font-ui);font-size:var(--text-2xs);color:var(--text-muted);line-height:1.45;margin:8px 0 0;max-width:60ch}
@media (min-width:768px){
  .ov-wrap{padding:26px 28px 44px}
  .ov-grid{grid-template-columns:1.3fr 1fr;align-items:start}
  .ov-hero-band{padding:24px 26px 20px}
  .ov-hero-chart{padding:18px 22px 4px}
  .ov-hero-strip{padding:14px 24px 18px}
}
@media (prefers-reduced-motion:reduce){
  .ov-preview{transition:none}
  .ov-cross{transition:none}
  .ov-leg-btn{transition:none}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto", width: "100%" },
  head: { display: "flex", alignItems: "center", gap: 13, marginBottom: 18 },
  headIcon: { width: 44, height: 44, flex: "none", borderRadius: 13, display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", boxShadow: "0 0 26px -6px color-mix(in oklab, var(--brand) 78%, transparent)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "var(--tracking-tight)" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "3px 0 0" },

  // Hero — the section anchor: heavier shadow than the supporting cards below,
  // so the hierarchy reads hero-first. Overflow-hidden clips the band gradient
  // to the rounded corners.
  hero: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-md)", overflow: "hidden", marginBottom: 16 },

  heroBand: {},
  heroEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand-active)" },
  heroHeadline: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", margin: "8px 0 12px", lineHeight: 1.25, maxWidth: "22ch" },
  forecastRow: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 },
  forecastBig: { fontFamily: "var(--font-mono)", fontSize: 46, fontWeight: 900, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
  forecastApprox: { fontSize: 30, fontWeight: 700, color: "var(--text-muted)", marginRight: 2, verticalAlign: "0.06em" },
  forecastUnit: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },

  // Latest-band chip — a small glass tile on the tinted band; anchors the right.
  heroChip: { display: "inline-flex", alignItems: "baseline", gap: 5, flex: "none", padding: "7px 12px", borderRadius: "var(--radius-full)", background: "color-mix(in oklab, var(--surface) 78%, transparent)", border: "1px solid var(--border)", boxShadow: "var(--shadow-xs)" },
  heroChipLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  heroChipVal: { fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" },
  heroChipMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-muted)" },

  unlockRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  unlockPip: { width: 30, height: 6, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border)" },
  unlockPipOn: { background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", boxShadow: "0 0 8px -2px color-mix(in oklab, var(--brand) 70%, transparent)" },
  unlockMeta: { marginLeft: 4, fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--text-muted)" },

  verdictGood: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--success-text)", background: "var(--success-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px", display: "inline-block" },
  verdictWarn: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", borderRadius: "var(--radius-md)", padding: "9px 13px", display: "inline-block" },
  verdictNeutral: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px", display: "inline-block" },

  stripItem: { display: "inline-flex", alignItems: "center", gap: 4 },
  stripDot: { width: 3, height: 3, borderRadius: "50%", background: "var(--text-disabled)", margin: "0 4px", flex: "none" },
  stripB: { fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)" },

  heroEmpty: { padding: "26px 24px 28px" },
  heroEmptyIcon: { width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)", marginBottom: 12 },
  heroEmptyTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" },
  heroEmptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 14px", maxWidth: 480 },

  card: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  sectionTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },

  readyHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  readyCount: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", flex: "none" },
  readySub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.45 },
  readyRow: { display: "flex", alignItems: "center", gap: 12 },
  readyIcon: { width: 32, height: 32, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  readyIconGhost: { background: "var(--surface-inset)", color: "var(--text-muted)" },
  readyLabelRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  readyLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" },
  readyBand: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", display: "inline-flex", alignItems: "center" },
  readyStart: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", flex: "none" },
  readyTrack: { position: "relative", height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden", marginTop: 6 },
  readyFill: { height: "100%", borderRadius: "var(--radius-full)", background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", transformOrigin: "left" },
  readyTick: { position: "absolute", top: -2, bottom: -2, width: 2, background: "var(--gold-500)" },

  previewCard: { display: "flex", alignItems: "center", gap: 13, padding: "15px 17px", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", textDecoration: "none", boxShadow: "var(--shadow-sm)" },
  previewIcon: { width: 42, height: 42, flex: "none", borderRadius: 12, display: "grid", placeItems: "center" },
  previewLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)" },
  previewValue: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  previewHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)" },
};
