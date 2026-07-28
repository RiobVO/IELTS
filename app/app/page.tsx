import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { db } from "@/db";
import { leaderboardEntry } from "@/db/schema";
import { categoryLabel, qtypeLabel, LISTENING_CATEGORIES } from "@/lib/labels";
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
  content_item: { title: string; category: string } | null;
}

interface Weak {
  type: string;
  label: string;
  correct: number;
  total: number;
  section: "reading" | "listening";
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

export default async function Dashboard() {
  const user = await requireUser();
  const supabase = await createClient();

  // Профиль / список попыток / глобальный ранг независимы → один Promise.all
  // (без водопада). Ранг читается owner-путём, но строго по своему user_id.
  const [profile, attemptsRes, rankRows] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select(
        "id,content_item_id,raw_score,band_score,per_type_breakdown,submitted_at,content_item:content_item_id(title,category)",
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
  const gapNum =
    bandLatest != null && bandTarget != null ? bandTarget - bandLatest : null;

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

  // Weak areas — агрегируем per_type_breakdown по всем попыткам (без доп. запроса).
  // Слабые типы агрегируем по всем попыткам, НО запоминаем, в какой секции
  // (reading/listening) теряются очки — чтобы deep-link «Fix this weakness» вёл
  // в правильный каталог (listening-only типы вроде map_labelling в reading пусты).
  const listeningCats = new Set<string>(LISTENING_CATEGORIES);
  const agg: Record<string, { correct: number; total: number; rLost: number; lLost: number }> = {};
  for (const a of attempts) {
    const b = a.per_type_breakdown;
    if (!b) continue;
    const listening = listeningCats.has(a.content_item?.category ?? "");
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0, rLost: 0, lLost: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      const lost = v.total - v.correct;
      if (listening) cur.lLost += lost;
      else cur.rLost += lost;
      agg[type] = cur;
    }
  }
  const weak: Weak[] = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .map(([type, v]) => ({
      type,
      label: qtypeLabel(type),
      correct: v.correct,
      total: v.total,
      // Туда, где реально теряются очки; ничья → reading (больший каталог).
      section: (v.lLost > v.rLost ? "listening" : "reading") as "reading" | "listening",
    }))
    .sort((x, y) => x.correct / x.total - y.correct / y.total)
    .slice(0, 5);
  const weakest = weak[0] ?? null;
  const hasAttempts = attempts.length > 0;

  // Доля верных по всем типам — для тёплой строки нормализации, когда юзер реально
  // буксует. Бренд candid, но не карающий: не сыпать «worst / lose points» без
  // поддержки в самый уязвимый момент (ученик-не-носитель на низком старте).
  const totals = Object.values(agg).reduce(
    (s, v) => ({ c: s.c + v.correct, t: s.t + v.total }),
    { c: 0, t: 0 },
  );
  const struggling = totals.t > 0 && totals.c / totals.t < 0.35;

  return (
    <AppShell active="dashboard">
      <style>{DASH_CSS}</style>
      <div className="dash-wrap" style={S.wrap}>
        {/* Greeting */}
        <div style={S.greet}>
          <div>
            <div style={S.eyebrow}>Welcome back</div>
            <h1 className="dash-hi" style={S.hi}>Hi, {name}</h1>
          </div>
          <div style={S.date}>{today}</div>
        </div>

        {/* Focus — единственный визуальный якорь, full-width */}
        <FocusCard weakest={weakest} />

        {/* Where you lose points — сразу под фокусом (ядро экрана) */}
        {weak.length > 0 && (
          <div className="dash-sect" style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <h2 style={S.sectionTitle}>Where you lose points</h2>
              <Badge tone="error">Worst first</Badge>
              <Link href="/app/reading" style={S.drillAny}>
                Browse all →
              </Link>
            </div>
            <p style={S.lossLead}>
              Closing your weakest types is the fastest route
              {bandTarget != null ? (
                <>
                  {" "}
                  to your <strong style={S.leadStrong}>{bandTarget}</strong>.
                </>
              ) : (
                " to a higher band."
              )}
            </p>
            {struggling && (
              <p style={S.lossNorm}>
                Everyone starts here — pick one type and your band climbs faster than you think.
              </p>
            )}
            {weak.slice(0, 3).map((w, i) => (
              <LossRow key={w.type} item={w} idx={i} />
            ))}
            {weak.length > 3 && (
              <details className="dash-more">
                <summary style={S.moreSummary}>
                  Show {weak.length - 3} more
                  <Icon name="chevron-down" size={16} strokeWidth={2.4} />
                </summary>
                {weak.slice(3).map((w, i) => (
                  <LossRow key={w.type} item={w} idx={i + 3} />
                ))}
              </details>
            )}
          </div>
        )}

        {/* Band readout */}
        <BandReadout band={bandLatest} target={bandTarget} gap={gapNum} hasAttempts={hasAttempts} />

        {/* This week — тонкая полоса momentum под диагностикой, не co-hero */}
        <WeekCard streak={streak} xp={xp} rating={rating} rank={globalRank} week={week} />

        {/* Recent tests */}
        <div className="dash-sect-tight" style={S.card}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ ...S.sectionTitle, fontSize: "var(--text-lg)" }}>Recent tests</h2>
            <Link href="/app/reading" style={S.viewAll}>
              View all →
            </Link>
          </div>
          {attempts.length === 0 ? (
            <div style={S.empty}>
              No tests yet. Take your first test from the catalog — your score and per-type
              breakdown will show up here.
            </div>
          ) : (
            attempts.slice(0, 5).map((a) => <TestRow key={a.id} a={a} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* Focus hero — слабейший тип как фокус дня; для нового юзера — заход в первый тест. */
function FocusCard({ weakest }: { weakest: Weak | null }) {
  const pct = weakest ? Math.round((weakest.correct / weakest.total) * 100) : 0;
  return (
    <div className="dash-focus" style={S.focus}>
      <img src="/bando-mark.svg" alt="" aria-hidden="true" style={S.focusMark} />
      <div style={S.focusInner}>
        <div style={S.focusEyebrow}>
          <Icon name="target" size={15} strokeWidth={2.6} /> Today&apos;s focus
        </div>
        {weakest ? (
          <>
            <h2 className="dash-focus-title" style={S.focusTitle}>{weakest.label}</h2>
            <p style={S.focusText}>
              Your weakest type so far — closing it is the single fastest move toward your band.
            </p>
            <div style={{ marginTop: 22 }}>
              <div style={S.focusProgHead}>
                <span style={S.focusProgLabel}>Accuracy</span>
                <span style={S.focusProgVal}>
                  {weakest.correct} / {weakest.total}
                </span>
              </div>
              <div aria-hidden="true" style={S.focusTrack}>
                <div style={{ ...S.focusFill, width: `${pct}%` }} />
              </div>
            </div>
            <div style={S.focusCta}>
              <Button variant="secondary" size="lg" trailingIcon="arrow-right" href={`/app/${weakest.section}?q_type=${encodeURIComponent(weakest.type)}`} style={{ color: "var(--brand-active)" }}>
                Fix this weakness
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="dash-focus-title" style={S.focusTitle}>Take your first test</h2>
            <p style={S.focusText}>
              Sit a test to surface your weakest question type — then we&apos;ll point your daily
              focus straight at it.
            </p>
            <div style={S.focusCta}>
              <Button variant="secondary" size="lg" trailingIcon="arrow-right" href="/app/reading" style={{ color: "var(--brand-active)" }}>
                Browse tests
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
}: {
  streak: number;
  xp: number;
  rating: number;
  rank: number | null;
  week: readonly { lab: string; name: string; count: number; state: "today" | "on" | "off" }[];
}) {
  const dot = {
    today: { background: "var(--streak)" },
    on: { background: "color-mix(in oklab, var(--streak) 16%, var(--surface))" },
    off: { background: "var(--surface-inset)" },
  } as const;
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
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
            >
              <div aria-hidden="true" style={{ width: "100%", height: 30, borderRadius: 9, ...dot[w.state] }} />
              <div aria-hidden="true" style={S.weekLab}>{w.lab}</div>
              {/* Hover-ридаут столбца: число тестов / today / rest — декоративный
                  (aria-hidden), доступную версию несёт aria-label ячейки. */}
              <span aria-hidden="true" className="daytip">{weekdayTip(w)}</span>
            </div>
          ))}
        </div>
        <Link href="/app/leaderboard" style={S.weekLeague}>
          <span style={S.leagueIcSm}>
            <Icon name="crown" size={18} strokeWidth={2.2} />
          </span>
          <span style={S.leagueName}>{rank != null ? "Global league" : "Unranked"}</span>
          {rank != null ? (
            <span style={S.leagueRank}>#{rank}</span>
          ) : (
            <span style={S.leagueHint}>Take a rated test</span>
          )}
          {/* Голую Elo-цифру (rating) прячем до ranked — для не-носителя на старте
              «1000» это шум; показываем её только когда место в лиге уже есть. */}
          {rank != null && <span style={S.leagueRating}>{rating}</span>}
        </Link>
        <div className="dash-week-cta">
          <Button icon="play" href="/app/reading" style={{ justifyContent: "center" }}>
            Continue practice
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Band readout — slim шкала band→target, в трёх честных состояниях (W1-4). */
function BandReadout({
  band,
  target,
  gap,
  hasAttempts,
}: {
  band: number | null;
  target: number | null;
  gap: number | null;
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
  const caption =
    target == null
      ? "Your latest full-mock band."
      : gap != null && gap > 0
        ? `${gap.toFixed(1)} band to go`
        : "Target reached 🎯";
  return (
    <div style={{ ...S.card, ...S.bandCard, ...S.bandCardFilled }}>
      <div style={{ flex: "none" }}>
        <div style={S.bandLabel}>Your band</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
          <span className="dash-band-num" style={S.bandNum}>{band}</span>
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
        <div style={S.bandScale}>
          <div style={{ ...S.bandFill, width: `${fillPct}%` }} />
          {target != null && (
            <div style={{ ...S.bandTick, left: `calc(${(target / 9) * 100}% - 2px)` }} />
          )}
        </div>
        <div style={S.bandLegend}>
          <span>0</span>
          <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{caption}</span>
          <span>9</span>
        </div>
      </div>
    </div>
  );
}

function LossRow({ item, idx }: { item: Weak; idx: number }) {
  const pct = Math.round((item.correct / item.total) * 100);
  const lost = item.total - item.correct;
  const worst = idx === 0;
  return (
    // Deep-link в дрилл этого типа В ЕГО СЕКЦИИ — listening-слабость не уводим в
    // reading-каталог (там её типа нет). Каталог фильтрует по ?q_type (_CatalogView).
    <Link className="dash-loss" href={`/app/${item.section}?q_type=${encodeURIComponent(item.type)}`} style={S.loss}>
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
      <span style={S.lossPts}>{lost} missed</span>
      <span style={{ color: "var(--text-disabled)", flex: "none" }}>
        <Icon name="chevron-right" size={18} strokeWidth={2.2} />
      </span>
    </Link>
  );
}

function TestRow({ a }: { a: AttemptRow }) {
  const t = total(a.per_type_breakdown);
  const band = a.band_score != null ? Number(a.band_score) : null;
  const score =
    a.raw_score != null && t
      ? `${a.raw_score} / ${t}`
      : a.raw_score != null
        ? String(a.raw_score)
        : "—";
  const meta = `${a.content_item ? categoryLabel(a.content_item.category) : ""}${
    a.submitted_at ? ` · ${relTime(a.submitted_at)}` : ""
  }`;
  return (
    <Link className="dash-trow" href={`/app/reading/${a.content_item_id}/result?a=${a.id}`} style={S.trow}>
      <span style={S.trowIc}>
        <Icon name="book-open" size={19} strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.trowTitle}>{a.content_item?.title ?? "Test"}</div>
        <div style={S.trowMeta}>{meta}</div>
      </div>
      {band != null && (
        <Badge tone="brand" mono>
          band {band}
        </Badge>
      )}
      <span style={S.trowScore}>{score}</span>
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
.dash-wrap{padding:20px 16px 48px}
.dash-hi{font-size:26px;white-space:normal}
.dash-focus{padding:26px}
.dash-focus-title{font-size:34px}
.dash-sect{padding:20px 16px}
.dash-sect-tight{padding:18px 16px 8px}
.dash-band{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.dash-band-num{font-size:60px}
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
.dash-week-dots{display:flex;gap:7px;width:100%}
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
@media (min-width:768px){
  .dash-wrap{padding:32px 28px 56px}
  .dash-hi{font-size:32px;white-space:nowrap}
  .dash-focus-title{font-size:42px}
  .dash-band-num{font-size:72px}
  .dash-band{flex-direction:row;align-items:center;gap:32px}
  .dash-focus{padding:38px}
  .dash-sect{padding:28px 30px}
  .dash-sect-tight{padding:22px 30px 12px}
  .dash-week{padding:14px 22px}
  .dash-week-row{flex-direction:row;align-items:center;gap:18px 22px;flex-wrap:wrap}
  .dash-week-dots{flex:1;width:auto;min-width:170px;max-width:300px}
  .dash-week-cta{width:auto;margin-left:auto}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-sm)",
  },

  greet: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 },
  eyebrow: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--brand)",
  },
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
    background: "linear-gradient(150deg, var(--brand-active), color-mix(in oklab, var(--brand-active) 78%, black))",
    boxShadow: "var(--shadow-md)",
    display: "flex",
    flexDirection: "column",
  },
  focusInner: { position: "relative", display: "flex", flexDirection: "column", height: "100%" },
  focusMark: { position: "absolute", right: -30, bottom: -34, width: 220, height: 220, opacity: 0.18, pointerEvents: "none" },
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
  leagueRating: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--brand)", background: "var(--brand-subtle)", borderRadius: "var(--radius-full)", padding: "3px 9px" },
  leagueHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--brand-active)" },

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
  trowTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  trowMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 },
  trowScore: { fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)", minWidth: 64, textAlign: "right" },

  empty: {
    padding: "1.5rem 0 2rem",
    textAlign: "center",
    color: "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
  },
};
