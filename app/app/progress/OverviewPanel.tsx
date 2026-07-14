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

  return (
    <div className="ov-hero" style={S.heroCard}>
      <div style={S.heroHead}>
        <h2 style={S.heroTitle}>
          <Icon name="bar-chart" size={18} strokeWidth={2.4} style={{ color: "var(--brand)" }} /> Trajectory
        </h2>
        <p style={S.heroSub}>Band across every full mock, mixed reading + listening.</p>
      </div>

      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height="auto" role="img" aria-label={`Band trajectory, latest ${last.band}`} style={S.svg}>
        {gridBands.map((b) => (
          <g key={b}>
            <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yScale(b)} y2={yScale(b)} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={PAD_L - 6} y={yScale(b) + 3} textAnchor="end" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-muted)">
              {b}
            </text>
          </g>
        ))}

        {targetY != null && (
          <>
            <line x1={PAD_L} x2={CHART_W - PAD_R} y1={targetY} y2={targetY} stroke="var(--gold-500)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={CHART_W - PAD_R} y={targetY - 5} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--gold-500)">
              Target {targetBand}
            </text>
          </>
        )}

        {examX != null && (
          <>
            <line x1={examX} x2={examX} y1={PAD_T} y2={CHART_H - PAD_B} stroke="var(--brand-active)" strokeWidth={1.5} strokeDasharray="3 3" />
            {/* Возле правого края подпись "Exam" справа от линии обрежется — уводим
                её влево от линии и меняем anchor, чтобы текст остался в кадре. */}
            {examX > CHART_W - PAD_R - 28 ? (
              <text x={examX - 5} y={PAD_T + 9} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--brand-active)">
                Exam
              </text>
            ) : (
              <text x={examX + 5} y={PAD_T + 9} fontSize={9} fontFamily="var(--font-ui)" fontWeight={700} fill="var(--brand-active)">
                Exam
              </text>
            )}
          </>
        )}

        {showForecast && (
          <>
            <polygon
              data-fade
              points={`${lastScaled.x.toFixed(1)},${lastScaled.y.toFixed(1)} ${horizonX!.toFixed(1)},${highY!.toFixed(1)} ${horizonX!.toFixed(1)},${lowY!.toFixed(1)}`}
              fill="color-mix(in oklab, var(--brand) 16%, transparent)"
              opacity={1}
            />
            <line
              data-fade
              x1={lastScaled.x}
              y1={lastScaled.y}
              x2={horizonX!}
              y2={projY!}
              stroke="var(--brand)"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
              opacity={1}
            />
          </>
        )}

        {readingPts && (
          <polyline
            data-draw={polylineLength(readingPts).toFixed(1)}
            points={pointsAttr(readingPts)}
            fill="none"
            stroke="var(--sky-500)"
            strokeWidth={1.5}
            strokeDasharray={polylineLength(readingPts)}
            strokeDashoffset={0}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.65}
          />
        )}
        {listeningPts && (
          <polyline
            data-draw={polylineLength(listeningPts).toFixed(1)}
            points={pointsAttr(listeningPts)}
            fill="none"
            stroke="var(--violet-300)"
            strokeWidth={1.5}
            strokeDasharray={polylineLength(listeningPts)}
            strokeDashoffset={0}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.65}
          />
        )}
        <polyline
          data-draw={combinedLen.toFixed(1)}
          points={pointsAttr(combinedPts)}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={2.5}
          strokeDasharray={combinedLen}
          strokeDashoffset={0}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {combinedPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={pts[i].section === "listening" ? "var(--violet-300)" : "var(--sky-500)"} />
        ))}
        <circle
          data-pop
          cx={lastScaled.x}
          cy={lastScaled.y}
          r={5}
          fill="var(--brand)"
          stroke="var(--surface)"
          strokeWidth={2}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
        <text x={Math.min(lastScaled.x + 8, CHART_W - PAD_R - 24)} y={lastScaled.y - 8} fontSize={10} fontWeight={700} fontFamily="var(--font-mono)" fill="var(--text-primary)">
          {last.band.toFixed(1)}
        </text>

        <text x={PAD_L} y={CHART_H - 6} fontSize={9} fontFamily="var(--font-ui)" fill="var(--text-muted)">
          {fmtDate(xMin)}
        </text>
        <text x={CHART_W - PAD_R} y={CHART_H - 6} textAnchor="end" fontSize={9} fontFamily="var(--font-ui)" fill="var(--text-muted)">
          {fmtDate(xMax)}
        </text>
      </svg>

      <div style={S.legend}>
        <LegendDot color="var(--brand)" label="Combined" />
        <LegendDot color="var(--sky-500)" label="Reading" />
        <LegendDot color="var(--violet-300)" label="Listening" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={S.legendItem}>
      <span style={{ ...S.legendSwatch, background: color }} />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Forecast card                                                              */
/* -------------------------------------------------------------------------- */

function ForecastCard({ forecast }: { forecast: Forecast }) {
  if (forecast.status === "insufficient") {
    const remaining = Math.max(0, 3 - forecast.pointCount);
    return (
      <div style={S.card}>
        <h2 style={S.sectionTitle}>Forecast</h2>
        <p style={S.forecastEmpty}>
          Forecasts unlock after 3 full mocks — sit {remaining} more to see where you&apos;re headed.
        </p>
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
    no_target: "Set a target band during onboarding to see if you're on pace",
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
        <span style={S.forecastBig}>
          <span data-countup={forecast.projectedBand ?? 0} data-decimals="1">
            {forecast.projectedBand?.toFixed(1)}
          </span>
        </span>
        <span style={S.forecastUnit}>projected band</span>
      </div>
      {forecast.interval && (
        <p style={S.forecastRange}>
          {forecast.interval.low.toFixed(1)}–{forecast.interval.high.toFixed(1)} likely by{" "}
          {forecast.horizonDate ? fmtDate(Date.parse(`${forecast.horizonDate}T00:00:00Z`)) : "then"}
        </p>
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
  return (
    <div style={S.card}>
      <h2 style={S.sectionTitle}>Readiness</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {readiness.skills.map((s) => (
          <ReadinessRow key={s.skill} s={s} targetBand={readiness.targetBand} />
        ))}
      </div>
    </div>
  );
}

function ReadinessRow({ s, targetBand }: { s: SkillReadiness; targetBand: number | null }) {
  const meta = SKILL_META[s.skill];
  if (s.band == null) {
    return (
      <div data-row style={S.readyRow}>
        <span style={S.readyIcon}>
          <Icon name={meta.icon} size={16} strokeWidth={2.2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.readyLabel}>{meta.label}</div>
          <div style={S.readyEmpty}>No data yet</div>
        </div>
        <Link href={meta.href} style={S.readyCta}>
          Practise →
        </Link>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (s.band / 9) * 100));
  const tickPct = targetBand != null ? Math.max(0, Math.min(100, (targetBand / 9) * 100)) : null;

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
        <div style={S.previewValue}>{rank != null ? `#${rank}` : "Unranked"}</div>
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
@media (min-width:768px){
  .ov-wrap{padding:26px 28px 44px}
  .ov-grid{grid-template-columns:1.15fr 1fr}
  .ov-previews{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:reduce){
  .ov-preview{transition:none}
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
  svg: { display: "block", width: "100%", height: "auto" },
  legend: { display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-secondary)" },
  legendSwatch: { width: 9, height: 9, borderRadius: "50%", flex: "none" },

  heroEmptyIcon: { width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)", marginBottom: 12 },
  heroEmptyTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" },
  heroEmptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 14px", maxWidth: 480 },

  card: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  sectionTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", margin: 0 },

  forecastEmpty: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "10px 0 14px" },
  lowConf: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.4 },
  forecastRow: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 },
  forecastBig: { fontFamily: "var(--font-mono)", fontSize: 42, fontWeight: 900, color: "var(--brand)", lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
  forecastUnit: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" },
  forecastRange: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "6px 0 12px" },
  verdictGood: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--success-text)", background: "var(--success-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px" },
  verdictWarn: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", borderRadius: "var(--radius-md)", padding: "9px 13px" },
  verdictNeutral: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: "var(--radius-md)", padding: "9px 13px" },

  readyRow: { display: "flex", alignItems: "center", gap: 12 },
  readyIcon: { width: 32, height: 32, flex: "none", borderRadius: 9, display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" },
  readyLabelRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  readyLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" },
  readyBand: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)", display: "inline-flex", alignItems: "center" },
  readyEmpty: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  readyCta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--brand-active)", textDecoration: "none", flex: "none" },
  readyTrack: { position: "relative", height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden", marginTop: 6 },
  readyFill: { height: "100%", borderRadius: "var(--radius-full)", background: "linear-gradient(90deg, var(--brand), var(--brand-hover))", transformOrigin: "left" },
  readyTick: { position: "absolute", top: -2, bottom: -2, width: 2, background: "var(--gold-500)" },

  previewCard: { display: "flex", alignItems: "center", gap: 13, padding: "15px 17px", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", textDecoration: "none", boxShadow: "var(--shadow-sm)" },
  previewIcon: { width: 42, height: 42, flex: "none", borderRadius: 12, display: "grid", placeItems: "center" },
  previewLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  previewValue: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  previewHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)" },
};
