import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { db } from "@/db";
import { leaderboardEntry } from "@/db/schema";
import { getActiveBadges } from "@/lib/content/badges";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { qtypeLabel } from "@/lib/labels";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile | bando" };

type Breakdown = Record<string, { correct: number; total: number }> | null;

interface PaymentRow {
  id: string;
  provider: string;
  tier: string;
  period_months: number;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  created_at: string;
}
interface AttemptRow {
  per_type_breakdown: Breakdown;
  submitted_at: string | null;
}
interface BadgeRow {
  id: string;
  code: string;
  name: string;
}

const TIER_LABEL: Record<Tier, string> = { basic: "Basic", premium: "Premium", ultra: "Ultra" };
const STATUS_LABEL: Record<PaymentRow["status"], string> = { pending: "Pending", completed: "Paid", failed: "Failed" };

/** Уникальная Lucide-иконка на бейдж по `code` — зеркалит маппинг страницы badges. */
const BADGE_ICON: Record<string, IconName> = {
  first_test: "footprints", tests_10: "dumbbell", tests_50: "route",
  streak_3: "zap", streak_7: "flame", streak_30: "shield",
  perfect: "sparkles", rating_1200: "star", rating_1500: "award",
  tfng_sniper: "target", completion_pro: "pencil-check", champion: "crown",
};
const badgeIcon = (code: string): IconName => BADGE_ICON[code] ?? "award";

/** Календарный ключ дня (UTC) — дедуп активности для week-dots (как на дашборде). */
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(amount / 100));
}
function initials(name: string, email?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || email?.[0] || "U").toUpperCase();
}

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile();
  const supabase = await createClient();

  const current: Tier = profile
    ? effectiveTier({ tier: profile.tier, premium_until: profile.premium_until })
    : "basic";

  // Всё независимо → один Promise.all (без водопада). attempt/payment/user_badge —
  // RLS owner-scoped; region/badge — публичные; rank читается строго по своему user_id.
  const [
    { count: testsTaken },
    { data: bandTop },
    { data: attemptData },
    { data: paymentData },
    regionName,
    rankRows,
    badgeData,
    { data: earnedData },
  ] = await Promise.all([
    supabase.from("attempt").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supabase
      .from("attempt")
      .select("band_score")
      .eq("status", "submitted")
      .not("band_score", "is", null)
      .order("band_score", { ascending: false })
      .limit(1),
    supabase
      .from("attempt")
      .select("per_type_breakdown,submitted_at")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(30),
    supabase
      .from("payment")
      .select("id,provider,tier,period_months,amount,currency,status,created_at")
      .order("created_at", { ascending: false }),
    (async () => {
      if (!profile?.region_id) return null;
      const { data } = await supabase.from("region").select("name").eq("id", profile.region_id).single();
      return data?.name ?? null;
    })(),
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
    getActiveBadges(),
    supabase.from("user_badge").select("badge_id,earned_at").eq("user_id", user.id),
    // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
    getHeaderData(),
  ]);

  const payments = (paymentData ?? []) as PaymentRow[];
  const attempts = (attemptData ?? []) as AttemptRow[];
  const bestBand = bandTop?.[0]?.band_score != null ? Number(bandTop[0].band_score) : null;
  const target = profile?.target_band != null ? Number(profile.target_band) : null;
  const gap = bestBand != null && target != null ? Math.max(0, Math.round((target - bestBand) * 10) / 10) : null;
  const memberSince = profile?.created_at ? new Date(profile.created_at).getFullYear() : null;
  const subLine = [regionName, memberSince ? `Member since ${memberSince}` : null].filter(Boolean).join(" · ");
  const streak = profile?.current_streak ?? 0;
  const rating = profile?.rating ?? 1000;
  const globalRank = rankRows[0]?.rank ?? null;

  // Слабейший тип — агрегат per_type_breakdown по попыткам (тот же расчёт, что на дашборде).
  const agg: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    if (!a.per_type_breakdown) continue;
    for (const [t, v] of Object.entries(a.per_type_breakdown)) {
      const cur = agg[t] ?? { correct: 0, total: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      agg[t] = cur;
    }
  }
  const weakest = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .map(([t, v]) => ({ label: qtypeLabel(t), ratio: v.correct / v.total }))
    .sort((x, y) => x.ratio - y.ratio)[0] ?? null;

  // Week-dots — реальная активность за 7 дней (из submitted_at).
  const activeDays = new Set(attempts.filter((a) => a.submitted_at).map((a) => dayKey(new Date(a.submitted_at!))));
  const now = new Date();
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - i)));
    return { lab: DOW[d.getUTCDay()], on: i === 6 || activeDays.has(dayKey(d)), today: i === 6 };
  });

  // Achievements preview — реальные earned (как на странице badges); earned-first, 6 ячеек.
  const badges: BadgeRow[] = badgeData;
  const earnedMap = new Map<string, string>(
    ((earnedData ?? []) as { badge_id: string; earned_at: string }[]).map((e) => [e.badge_id, e.earned_at]),
  );
  const earnedCount = badges.filter((b) => earnedMap.has(b.id)).length;
  const preview = [...badges]
    .sort((a, b) => Number(earnedMap.has(b.id)) - Number(earnedMap.has(a.id)))
    .slice(0, 6)
    .map((b) => ({ code: b.code, earned: earnedMap.has(b.id) }));

  // Goal-ring геометрия (best → target по шкале 0..9).
  const R = 52, CX = 64, CY = 64;
  const CIRC = 2 * Math.PI * R;
  const p = bestBand != null ? Math.min(1, bestBand / 9) : 0;
  const tRad = ((-90 + 360 * ((target ?? 0) / 9)) * Math.PI) / 180;
  const tx = CX + R * Math.cos(tRad);
  const ty = CY + R * Math.sin(tRad);

  return (
    <AppShell active="profile">
      <style>{PF_CSS}</style>
      <div className="pf-wrap" style={S.wrap}>
        {/* Мобильный путь назад — на &le;430px бургер единственный выход, добавляем явную ссылку. */}
        <div className="mob-back">
          <Button variant="ghost" size="sm" icon="arrow-left" href="/app">Home</Button>
        </div>
        {/* Identity */}
        <div style={S.idRow}>
          <div style={S.avatar}>{initials((profile?.display_name ?? "") as string, profile?.email ?? user.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={S.h1}>{profile?.display_name ?? profile?.email ?? "—"}</h1>
              <Badge tone={current === "basic" ? "neutral" : "brand"}>{TIER_LABEL[current]}</Badge>
            </div>
            {subLine && <div style={S.subLine}>{subLine}</div>}
          </div>
        </div>

        {/* GOAL HERO — road to your band */}
        <div className="pf-hero" style={S.hero}>
          <div style={S.ringBox}>
            <svg width={128} height={128} viewBox="0 0 128 128">
              <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth={11} />
              <circle
                cx={CX} cy={CY} r={R} fill="none" stroke="#fff" strokeWidth={11} strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - p)} transform={`rotate(-90 ${CX} ${CY})`}
              />
              {target != null && <circle cx={tx} cy={ty} r={6} fill="var(--brand-active)" stroke="#fff" strokeWidth={3} />}
            </svg>
            <div style={S.ringCenter}>
              <div style={S.ringNum}>{bestBand != null ? bestBand.toFixed(1) : "—"}</div>
              <div className="pf-ring-cap" style={S.ringCap}>best band</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.heroEyebrow}>{target != null ? `Your road to band ${target.toFixed(1)}` : "Your road to your band"}</div>
            <div style={S.heroTitle}>
              {gap != null && gap > 0
                ? <>You&apos;re <span style={S.heroMono}>{gap.toFixed(1)}</span> band from your target.</>
                : gap != null
                  ? "You've reached your target band."
                  : bestBand == null
                    ? "Take a test to get your first band."
                    : "Set a target band to track your goal."}
            </div>
            <p style={S.heroText}>
              {weakest
                ? "Closing the gap is mostly one weak type. Knock it out and the band moves."
                : "Sit a full test and your weakest type becomes your fastest band win."}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <Button href="/app/reading" icon="play" style={{ background: "#fff", color: "var(--brand-active)" }}>
                Take a test
              </Button>
              <Button href="/app" variant="ghost" trailingIcon="arrow-right" style={{ background: "rgba(255,255,255,.14)", color: "var(--text-on-brand)" }}>
                View progress
              </Button>
            </div>
          </div>
        </div>

        {/* NEXT MOVE + momentum */}
        <div className="pf-duo" style={S.duo}>
          <a href="/app/reading" style={S.nextCard}>
            <span style={S.nextIcon}><Icon name="target" size={24} strokeWidth={2.3} /></span>
            <div style={{ flex: 1 }}>
              <div style={S.nextEyebrow}>Your next move</div>
              <div style={S.nextTitle}>{weakest ? `Drill ${weakest.label}` : "Take your first test"}</div>
              <div style={S.nextSub}>{weakest ? "Your weakest type — the fastest band win." : "We'll surface your weakest type from the result."}</div>
            </div>
            <span style={{ color: "var(--text-disabled)" }}><Icon name="chevron-right" size={20} strokeWidth={2.3} /></span>
          </a>
          <div style={S.weekCard}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 13 }}>
              <span className="pf-sub" style={S.sub}>This week</span>
              <span style={S.weekStreak}><Icon name="flame" size={13} strokeWidth={2.4} /> {streak}-day</span>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              {week.map((d, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ ...S.weekDot, background: d.on ? "color-mix(in oklab, var(--streak) 16%, var(--surface))" : "var(--surface-inset)", color: d.on ? "var(--streak)" : "var(--text-disabled)" }}>
                    {d.on && <Icon name="check" size={14} strokeWidth={2.6} />}
                  </div>
                  <div className="pf-week-lab" style={S.weekLab}>{d.lab}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Numbers strip — no dead tiles */}
        <div className="pf-strip" style={S.strip}>
          <StripStat icon="book-open" tone="var(--brand)" value={testsTaken ?? 0} label="Tests taken" />
          <StripStat icon="flame" tone="var(--streak)" value={streak} label="Day streak" />
          <StripStat icon="trophy" tone="var(--brand)" value={rating} label="Rating" />
          <StripStat icon="medal" tone="var(--warn-text)" value={globalRank != null ? `#${globalRank}` : "—"} label="League rank" />
        </div>

        {/* Achievements + invite */}
        <div className="pf-duo2" style={S.duo2}>
          <div style={S.achCard}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <span className="pf-sub" style={S.sub}>Achievements</span>
              <a href="/app/progress?tab=badges" style={S.achLink}>All {badges.length || 12} →</a>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {preview.map((b, i) => (
                <div key={i} style={{ ...S.achCell, background: b.earned ? "color-mix(in oklab, var(--brand) 14%, var(--surface))" : "var(--surface-inset)", color: b.earned ? "var(--brand)" : "var(--text-disabled)", boxShadow: b.earned ? "0 0 16px -6px var(--brand)" : "none" }}>
                  <Icon name={badgeIcon(b.code)} size={19} strokeWidth={2.2} />
                </div>
              ))}
            </div>
            <div style={S.achFoot}>{earnedCount} earned · <a href="/app/progress?tab=badges" style={S.achFootLink}>see what&apos;s next →</a></div>
          </div>
          <div style={S.invite}>
            <div aria-hidden="true" style={S.inviteGlow} />
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7, color: "var(--violet-300)" }}>
                <Icon name="users" size={18} strokeWidth={2.2} />
                <span style={S.inviteTitle}>Invite friends</span>
              </div>
              <p style={S.inviteText}>
                Each friend who finishes a test earns you <b style={{ color: "var(--surface-premium-ink)" }}>+100 XP</b> — they get <b style={{ color: "var(--surface-premium-ink)" }}>+50</b>.
              </p>
              <Button href="/app/invite" trailingIcon="arrow-right" size="sm" style={{ background: "#fff", color: "var(--brand-active)" }}>
                Share invite
              </Button>
            </div>
          </div>
        </div>

        {/* Account & billing — quiet, at the bottom */}
        <div style={S.quietCard}>
          <div style={S.quietHead}><span className="pf-sub" style={S.sub}>Account &amp; billing</span></div>
          <QuietRow icon="book-open" label="Email" value={profile?.email ?? user.email ?? "—"} />
          <QuietRow icon="bar-chart" label="Target band" value={target != null ? target.toFixed(1) : "Not set"} />
          <QuietRow icon="crown" label="Plan" value={TIER_LABEL[current]} />
          <QuietRow icon="clock" label="Subscription until" value={current === "basic" ? "—" : formatDate(profile?.premium_until ?? null)} last />
          <div style={S.quietFoot}>
            <span style={S.quietNote}>Basic is free forever. Premium adds full mock analytics.</span>
            <Button href="/app/upgrade" variant="secondary" size="sm" trailingIcon="arrow-right">
              {current === "basic" ? "Upgrade plan" : "Manage plan"}
            </Button>
          </div>
        </div>

        {/* Payment history — quiet */}
        <div style={S.quietCard}>
          <div style={S.quietHead}><span className="pf-sub" style={S.sub}>Payment history</span></div>
          {payments.length === 0 ? (
            <div style={S.payEmpty}>No payments yet.</div>
          ) : (
            payments.map((p, i) => (
              <div key={p.id} className="pf-payrow" style={{ ...S.payRow, ...(i < payments.length - 1 ? S.payDivide : {}) }}>
                <div>
                  <div style={S.payTitle}>{(TIER_LABEL[p.tier as Tier] ?? p.tier)} · {p.period_months} mo.</div>
                  <div style={S.payMeta}>{p.provider} · {formatDate(p.created_at)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={S.payAmount}>{formatAmount(p.amount)} {p.currency}</div>
                  <span style={{ display: "inline-flex", marginTop: 4 }}>
                    <Badge tone={p.status === "completed" ? "success" : p.status === "failed" ? "error" : "neutral"}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StripStat({ icon, tone, value, label }: { icon: IconName; tone: string; value: string | number; label: string }) {
  // Делители рисует CSS (.pf-stat) — на десктопе вертикальные, на мобильном 2×2.
  return (
    <div className="pf-stat" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px" }}>
      <span style={{ width: 38, height: 38, flex: "none", borderRadius: 11, display: "grid", placeItems: "center", background: `color-mix(in oklab, ${tone} 14%, var(--surface))`, color: tone }}>
        <Icon name={icon} size={19} strokeWidth={2.3} />
      </span>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", fontWeight: 600, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, fontWeight: 600 }}>{label}</div>
      </div>
    </div>
  );
}

function QuietRow({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: last ? "none" : "1px solid var(--border-subtle)" }}>
      <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface-inset)", color: "var(--text-secondary)" }}>
        <Icon name={icon} size={16} strokeWidth={2.1} />
      </span>
      <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{label}</span>
      {/* Длинный email не должен клиппиться/вылезать за карту на узких экранах. */}
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 600, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

// Адаптив профиля. База = мобильный (hero/duo/duo2 в стек, strip 2×2);
// ≥640px = десктоп. Делители strip и переключаемые grid/flex — в классах.
const PF_CSS = `
.pf-wrap{padding:22px 16px 44px}
.pf-hero{display:flex;flex-direction:column;align-items:flex-start;gap:18px;padding:22px 20px}
.pf-duo,.pf-duo2{display:grid;grid-template-columns:1fr;gap:12px}
.pf-strip{display:grid;grid-template-columns:1fr 1fr}
.pf-stat{border-bottom:1px solid var(--border-subtle);border-right:1px solid var(--border-subtle)}
.pf-stat:nth-child(2n){border-right:none}
.pf-stat:nth-child(n+3){border-bottom:none}
/* База: путь назад скрыт; медиа-override ниже показывает его на ≤430px. Правило
   должно стоять ДО @media — при равной специфичности выигрывает последнее в каскаде. */
.mob-back{display:none}
@media (min-width:640px){
  .pf-wrap{padding:28px 28px 48px}
  .pf-hero{flex-direction:row;align-items:center;gap:30px;padding:26px 30px}
  .pf-duo{grid-template-columns:1.15fr .85fr;gap:14px}
  .pf-duo2{grid-template-columns:1.1fr .9fr;gap:14px}
  .pf-strip{display:flex}
  .pf-stat{flex:1;border-bottom:none}
  .pf-stat:nth-child(2n){border-right:1px solid var(--border-subtle)}
  .pf-stat:last-child{border-right:none}
}
/* Узкие телефоны (≤430px): строка платежа (тариф+дата слева, сумма+статус справа)
   без переноса вылезает за карту — разрешаем wrap. */
@media (max-width:430px){
  .pf-payrow{flex-wrap:wrap;row-gap:6px}
  /* Микро-текст: "best band"/буква дня — смысловые лейблы → 12px; секционные
     uppercase-заголовки (This week/Achievements/…) — тоже 12px. */
  .pf-ring-cap{font-size:12px!important}
  .pf-week-lab{font-size:12px!important}
  .pf-sub{font-size:12px!important}
  /* Путь назад — виден только на узких телефонах (бургер иначе единственный выход). */
  .mob-back{display:block;margin-bottom:10px}
}
`;

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 840, margin: "0 auto" },
  idRow: { display: "flex", alignItems: "center", gap: 18, marginBottom: 18 },
  avatar: { width: 60, height: 60, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: 23, fontWeight: 800, boxShadow: "var(--shadow-md)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  subLine: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 },

  hero: { position: "relative", overflow: "hidden", borderRadius: "var(--radius-2xl)", background: "radial-gradient(520px 280px at 88% -40%, color-mix(in oklab, var(--violet-400) 55%, transparent), transparent 70%), linear-gradient(155deg, var(--brand), var(--brand-active) 70%, var(--violet-700))", color: "var(--text-on-brand)", marginBottom: 14 },
  ringBox: { position: "relative", width: 128, height: 128, flex: "none" },
  ringCenter: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" },
  ringNum: { fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em" },
  ringCap: { fontSize: 10.5, color: "rgba(255,255,255,.8)", marginTop: 3 },
  heroEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,.82)", fontWeight: 700 },
  heroTitle: { fontFamily: "var(--font-ui)", fontSize: 23, fontWeight: 800, margin: "8px 0 0", lineHeight: 1.2 },
  heroMono: { fontFamily: "var(--font-mono)", fontWeight: 600 },
  heroText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,.82)", margin: "8px 0 0", maxWidth: 380, lineHeight: 1.5 },

  duo: { marginBottom: 14, alignItems: "stretch" },
  nextCard: { display: "flex", alignItems: "center", gap: 16, padding: "20px 22px", background: "var(--surface)", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)", textDecoration: "none", color: "inherit" },
  nextIcon: { flex: "none", width: 48, height: 48, borderRadius: 14, background: "linear-gradient(160deg, var(--brand), var(--brand-active))", color: "var(--text-on-brand)", display: "grid", placeItems: "center", boxShadow: "0 0 22px -6px var(--brand)" },
  nextEyebrow: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--brand-active)" },
  nextTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, marginTop: 3 },
  nextSub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  weekCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", padding: "18px 20px" },
  weekStreak: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--streak)", display: "inline-flex", alignItems: "center", gap: 4 },
  weekDot: { height: 30, borderRadius: 9, display: "grid", placeItems: "center" },
  weekLab: { fontSize: 9.5, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 },

  strip: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", marginBottom: 14, overflow: "hidden" },

  duo2: { marginBottom: 14, alignItems: "stretch" },
  achCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", padding: "18px 20px" },
  achLink: { marginLeft: "auto", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-link)", textDecoration: "none" },
  achCell: { flex: 1, aspectRatio: "1", borderRadius: 13, display: "grid", placeItems: "center" },
  achFoot: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 12 },
  achFootLink: { color: "var(--text-secondary)", fontWeight: 700, textDecoration: "none" },

  invite: { position: "relative", overflow: "hidden", borderRadius: "var(--radius-xl)", background: "linear-gradient(160deg, var(--surface-premium), var(--surface-premium-deep))", padding: 20, color: "var(--surface-premium-ink)" },
  inviteGlow: { position: "absolute", top: -80, right: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 50%, transparent), transparent 64%)" },
  inviteTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--surface-premium-ink)", whiteSpace: "nowrap" },
  inviteText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "rgba(255,255,255,.7)", margin: "0 0 14px", lineHeight: 1.5 },

  quietCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", padding: "6px 22px 16px", marginBottom: 12 },
  quietHead: { display: "flex", alignItems: "center", padding: "15px 0 8px" },
  quietFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 12, flexWrap: "wrap" },
  quietNote: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  sub: { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" },

  payEmpty: { padding: "1.25rem 0", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  payRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" },
  payDivide: { borderBottom: "1px solid var(--border-subtle)" },
  payTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  payMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  payAmount: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
};
