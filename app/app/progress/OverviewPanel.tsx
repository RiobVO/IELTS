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
 * Overview — герой «Траектория» (band-график) + Прогноз + Readiness + компактные
 * превью League/Badges. Вычислительное ядро (Trajectory/Forecast/Readiness) —
 * src/lib/progress/overview.ts; здесь только owner-путь чтения и рендер. Один
 * Promise.all — R/L из RLS-scoped supabase, W/S band из owner-путей writing/read
 * и speaking/read (те же файлы, что кормят их каталоги), лига/бейджи — тем же
 * способом, что дашборд/BadgesPanel.
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
  // подаём только на график (trajectory.combined ниже, в TrajectoryHero).
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
      <div data-overview-root className="ov-wrap" style={S.wrap}>
        <ProgressTabs tab="overview" />
        <div style={S.head}>
          <div>
            <h1 style={S.h1}>Overview</h1>
            <p style={S.sub}>Your band trajectory, forecast, and readiness in one place.</p>
          </div>
        </div>

        <TrajectoryHero trajectory={trajectory} forecast={forecast} targetBand={targetBand} examDate={examDate} />

        <div className="ov-grid">
          <ForecastCard forecast={forecast} />
          <ReadinessCard readiness={readiness} />
        </div>

        <div className="ov-previews">
          <LeaguePreview rank={rank} />
          <BadgesPreview earned={earnedTotal} total={badges.length} next={nextBadge} />
        </div>
      </div>
      <OverviewMotion />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Trajectory hero — server-computed SVG geometry; the client island only     */
/* layers draw-in / fade / count-up motion on top (see OverviewMotion).       */
/* -------------------------------------------------------------------------- */

const CHART_W = 680;
const CHART_H = 230;
const PAD_L = 44;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 28;
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

// Гладкая линия (Catmull-Rom → кубический Безье) — вид «как в реальных графиках».
// Точки данных остаются ТОЧНЫМИ (маркеры рисуются ровно на них); кривая лишь
// связывает их визуально. Математику траектории/прогноза это не трогает.
interface Seg {
  p1: Scaled;
  c1: Scaled;
  c2: Scaled;
  p2: Scaled;
}
function catmullSegs(pts: Scaled[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    segs.push({
      p1,
      p2,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    });
  }
  return segs;
}
function smoothD(pts: Scaled[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (const s of catmullSegs(pts)) {
    d += ` C ${s.c1.x.toFixed(1)} ${s.c1.y.toFixed(1)}, ${s.c2.x.toFixed(1)} ${s.c2.y.toFixed(1)}, ${s.p2.x.toFixed(1)} ${s.p2.y.toFixed(1)}`;
  }
  return d;
}
// Длина кривой сэмплированием — для draw-in (stroke-dashoffset). С запасом (×1.02),
// чтобы dasharray статик-рендера гарантированно перекрывал путь без разрывов до гидрации.
function smoothLen(pts: Scaled[]): number {
  let len = 0;
  for (const s of catmullSegs(pts)) {
    let px = s.p1.x;
    let py = s.p1.y;
    for (let t = 1; t <= 40; t++) {
      const u = t / 40;
      const m = 1 - u;
      const x = m * m * m * s.p1.x + 3 * m * m * u * s.c1.x + 3 * m * u * u * s.c2.x + u * u * u * s.p2.x;
      const y = m * m * m * s.p1.y + 3 * m * m * u * s.c1.y + 3 * m * u * u * s.c2.y + u * u * u * s.p2.y;
      len += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
  }
  return len * 1.02;
}

function TrajectoryHero({
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

  if (pts.length === 0) {
    return (
      <div className="ov-hero" style={S.heroCard}>
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
    );
  }

  // Y domain — подгоняется под ТО, ЧТО реально на графике: баллы моков, цель и
  // проекция, + запас, округлённо по сетке 0.5, в пределах band [1,9]. Раньше ось
  // жёстко держала весь диапазон 4–9 → низкие плоские данные вжимались в самый низ,
  // а верх пустовал. Это окно обзора, НЕ шкала грейдинга — числа не меняются.
  const yVals = pts.map((p) => p.band);
  if (targetBand != null) yVals.push(targetBand);
  if (forecast.projectedBand != null) yVals.push(forecast.projectedBand);
  let yMin = Math.max(1, Math.floor((Math.min(...yVals) - 0.5) * 2) / 2);
  let yMax = Math.min(9, Math.ceil((Math.max(...yVals) + 0.5) * 2) / 2);
  // Гарантируем минимум ~2.5 балла по вертикали, иначе на плоских данных сетка
  // схлопывается в одну-две линии.
  if (yMax - yMin < 2.5) {
    yMax = Math.min(9, yMin + 2.5);
    yMin = Math.max(1, yMax - 2.5);
  }

  // X domain — ФОКУС НА СДАННЫХ МОКАХ. Это НЕ формула (грейдинг/прогноз/«до экзамена»
  // считаются так же), а окно обзора графика: ось охватывает моки + небольшой запас.
  // Горизонт прогноза и дата экзамена больше НЕ растягивают её на месяцы вперёд —
  // иначе свежие моки схлопываются в невидимую полоску у левого края. Полный прогноз
  // живёт в карточке Forecast; на графике — короткий пунктирный стаб + линия цели.
  const firstT = pts[0].t;
  const lastT = pts[pts.length - 1].t;
  const dataSpan = lastT - firstT;
  const leftPad = dataSpan > 0 ? dataSpan * 0.08 : 3 * DAY_MS;
  const rightPad = dataSpan > 0 ? Math.max(dataSpan * 0.25, 2 * DAY_MS) : 3 * DAY_MS;
  const xMin = firstT - leftPad;
  const xMax = lastT + rightPad;
  const examMs = examDate ? Date.parse(`${examDate}T00:00:00Z`) : NaN;

  const xScale = (t: number) => PAD_L + ((t - xMin) / (xMax - xMin)) * PLOT_W;
  const yScale = (b: number) => PAD_T + (1 - (b - yMin) / (yMax - yMin)) * PLOT_H;

  const combinedPts = scalePoints(pts, xScale, yScale);
  const combinedPath = smoothD(combinedPts);
  const combinedLen = smoothLen(combinedPts);
  const readingPts = trajectory.reading.length >= 2 ? scalePoints(trajectory.reading, xScale, yScale) : null;
  const listeningPts = trajectory.listening.length >= 2 ? scalePoints(trajectory.listening, xScale, yScale) : null;

  const gridBands: number[] = [];
  for (let b = Math.ceil(yMin); b <= Math.floor(yMax); b++) gridBands.push(b);

  const targetY = targetBand != null ? yScale(Math.min(Math.max(targetBand, yMin), yMax)) : null;
  // Линия экзамена — только если дата попадает в окно моков; далёкий экзамен несёт
  // карточка Forecast («by …»), а не растянутая на месяцы ось.
  const examInWindow = Number.isFinite(examMs) && examMs > Date.now() && examMs <= xMax;
  const examX = examInWindow ? xScale(examMs) : null;

  const last = pts[pts.length - 1];
  const lastScaled = combinedPts[combinedPts.length - 1];

  // Прогноз на графике — короткий пунктирный стаб от последней точки к правому краю
  // окна (не конус до далёкого горизонта). Полный интервал/дата — в карточке Forecast.
  const showForecast = forecast.status !== "insufficient" && forecast.projectedBand != null;
  const stubX = CHART_W - PAD_R;
  const projY = showForecast ? yScale(forecast.projectedBand!) : null;

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
    <div className="ov-hero" style={S.heroCard}>
      <div style={S.heroHead}>
        <h2 style={S.heroTitle}>
          <Icon name="bar-chart" size={18} strokeWidth={2.4} style={{ color: "var(--brand)" }} /> Trajectory
        </h2>
        <p style={S.heroSub}>Band across every full mock — hover any point for the detail.</p>
      </div>

      <TrajectoryChart
        w={CHART_W}
        h={CHART_H}
        padL={PAD_L}
        padR={PAD_R}
        padT={PAD_T}
        padB={PAD_B}
        combined={combined}
        combinedPath={combinedPath}
        combinedLen={Number(combinedLen.toFixed(1))}
        reading={readingPts ? { path: smoothD(readingPts), len: Number(smoothLen(readingPts).toFixed(1)) } : null}
        listening={listeningPts ? { path: smoothD(listeningPts), len: Number(smoothLen(listeningPts).toFixed(1)) } : null}
        grid={gridBands.map((b) => ({ band: b, y: yScale(b) }))}
        target={targetY != null ? { y: targetY, band: targetBand! } : null}
        exam={examX != null ? { x: examX, rightEdge: examX > CHART_W - PAD_R - 28 } : null}
        forecast={showForecast ? { lastX: lastScaled.x, lastY: lastScaled.y, horizonX: stubX, projY: projY! } : null}
        xLabelLeft={fmtDate(xMin)}
        xLabelRight={fmtDate(xMax)}
        latestBand={last.band}
      />

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forecast card                                                              */
/* -------------------------------------------------------------------------- */

function ForecastCard({ forecast }: { forecast: Forecast }) {
  if (forecast.status === "insufficient") {
    // Не «замок», а трек прогресса к прогнозу: показываем сколько моков уже
    // сдано из трёх нужных — момент движения вперёд, а не заглушка «данных нет».
    const done = Math.min(forecast.pointCount, 3);
    const remaining = Math.max(0, 3 - forecast.pointCount);
    return (
      <div style={S.card}>
        <h2 style={S.sectionTitle}>Forecast</h2>
        <p style={S.forecastEmpty}>
          {remaining === 0
            ? "Crunching your first projection — sit one more mock to refine it."
            : `${remaining} more full ${remaining === 1 ? "mock" : "mocks"} and we'll project your exam-day band.`}
        </p>
        <div style={S.unlockRow} role="img" aria-label={`${done} of 3 mocks toward your first forecast`}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ ...S.unlockPip, ...(i < done ? S.unlockPipOn : null) }} />
          ))}
          <span style={S.unlockMeta}>{done}/3 mocks</span>
        </div>
        <Button trailingIcon="arrow-right" href="/app/reading?category=full_reading" variant="secondary" style={{ color: "var(--brand-active)" }}>
          Sit a full mock
        </Button>
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
    <div style={S.card}>
      <h2 style={S.sectionTitle}>Forecast</h2>
      {forecast.status === "low_confidence" && (
        <p style={S.lowConf}>Early estimate — based on only {forecast.pointCount} mocks, confidence grows as you sit more.</p>
      )}
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
      {forecast.interval && (
        <p style={S.forecastRange}>
          {forecast.interval.low.toFixed(1)}–{forecast.interval.high.toFixed(1)} likely by{" "}
          {forecast.horizonDate ? fmtDate(Date.parse(`${forecast.horizonDate}T00:00:00Z`)) : "then"}
        </p>
      )}
      {forecast.interval && (
        // Объясняем, ЧТО такое диапазон и на чём он построен — не-native аудитории
        // «likely range» не самоочевиден; заодно закрывает methodology-пробел.
        <p style={S.forecastBasis}>
          The range you&apos;re 80% likely to land in, from your last {forecast.pointCount} {forecast.pointCount === 1 ? "mock" : "mocks"} — it narrows as you sit more.
        </p>
      )}
      {forecast.slopePerWeek != null && forecast.slopePerWeek > 0 && (
        <p style={S.forecastPace}>Improving ~{forecast.slopePerWeek.toFixed(2)} band per week lately</p>
      )}
      {verdictText[verdict] && <div style={verdictStyle}>{verdictText[verdict]}</div>}
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

// Адаптив Overview. База = мобильный (стек); ≥768px = две колонки для
// forecast/readiness и превью-карточек. Брейкпоинт-свойства только в классах.
const OV_CSS = `
.ov-wrap{padding:22px 16px 40px}
.ov-grid{display:grid;grid-template-columns:1fr;gap:14px;margin:16px 0}
.ov-previews{display:grid;grid-template-columns:1fr;gap:12px}
.ov-preview{transition:transform .12s,box-shadow .12s}
.ov-preview:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.ov-preview:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in oklab,var(--brand) 45%,transparent)}
.ov-chart{position:relative}
.ov-chart-svg:focus{outline:none}
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
.ov-lbl{position:absolute;font-size:var(--text-xs);line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}
.ov-lbl-grid{font-family:var(--font-mono);font-weight:600;color:var(--text-secondary);transform:translate(-100%,-50%)}
.ov-lbl-target{color:var(--warn-text);font-weight:700;transform:translate(-100%,-140%)}
.ov-lbl-exam{color:var(--brand-active);font-weight:700}
/* Текущий балл — не бледная цифра у линии, а brand-пилюля слева от последней точки:
   белым по фиолетовому это самый читаемый и главный числовой акцент графика. */
.ov-lbl-latest{font-family:var(--font-mono);font-weight:800;color:var(--text-on-brand);background:var(--brand);padding:2px 8px;border-radius:var(--radius-full);box-shadow:var(--shadow-sm);transform:translate(calc(-100% - 11px),-50%)}
.ov-lbl-axis{color:var(--text-secondary);font-weight:600}
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
  .ov-grid{grid-template-columns:1.15fr 1fr}
  .ov-previews{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:reduce){
  .ov-preview{transition:none}
  .ov-cross{transition:none}
  .ov-leg-btn{transition:none}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto", width: "100%" },
  head: { marginBottom: 16 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "4px 0 0" },

  heroCard: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "20px 22px", boxShadow: "var(--shadow-sm)" },
  heroHead: { marginBottom: 10 },
  heroTitle: { display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },
  heroSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "3px 0 0" },

  heroEmptyIcon: { width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)", marginBottom: 12 },
  heroEmptyTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" },
  heroEmptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 14px", maxWidth: 480 },

  card: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  sectionTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },

  forecastEmpty: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "10px 0 12px" },
  unlockRow: { display: "flex", alignItems: "center", gap: 6, margin: "0 0 16px" },
  unlockPip: { width: 30, height: 6, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border)" },
  unlockPipOn: { background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", boxShadow: "0 0 8px -2px color-mix(in oklab, var(--brand) 70%, transparent)" },
  unlockMeta: { marginLeft: 4, fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--text-muted)" },
  lowConf: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.4 },
  forecastRow: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 },
  forecastBig: { fontFamily: "var(--font-mono)", fontSize: 42, fontWeight: 900, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
  forecastApprox: { fontSize: 28, fontWeight: 700, color: "var(--text-muted)", marginRight: 2, verticalAlign: "0.06em" },
  forecastUnit: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
  forecastRange: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "6px 0 4px" },
  forecastBasis: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45, maxWidth: "46ch" },
  forecastPace: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.4 },
  verdictGood: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--success-text)", background: "var(--success-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px" },
  verdictWarn: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", borderRadius: "var(--radius-md)", padding: "9px 13px" },
  verdictNeutral: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px" },

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
