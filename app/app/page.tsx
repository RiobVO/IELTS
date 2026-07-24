import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel, qtypeLabel } from "@/lib/labels";
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

function total(b: Breakdown): number {
  if (!b) return 0;
  return Object.values(b).reduce((s, x) => s + x.total, 0);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export default async function Dashboard() {
  await requireUser();
  const supabase = await createClient();

  // Профиль и список попыток независимы → параллельно (2 round-trip'а → 1).
  const [profile, attemptsRes] = await Promise.all([
    getProfile(),
    supabase
      .from("attempt")
      .select(
        "id,content_item_id,raw_score,band_score,per_type_breakdown,submitted_at,content_item:content_item_id(title,category)",
      )
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(20),
  ]);
  // One-time onboarding gate (W1-2): until the user captures their profile we
  // can't show a band target or a named leaderboard entry. Send them there.
  if (profile && !profile.onboarded_at) redirect("/app/onboarding");

  const attempts = (attemptsRes.data ?? []) as unknown as AttemptRow[];

  // Профиль → band-кольцо + stat-строка.
  const streak = profile?.current_streak ?? 0;
  const xp = profile?.xp ?? 0;
  const rating = profile?.rating ?? 1000;
  const bandTarget = profile?.target_band != null ? Number(profile.target_band) : null;

  // Последняя попытка с выставленным band (single-passage тесты band не имеют).
  const banded = attempts.find((a) => a.band_score != null);
  const bandLatest = banded?.band_score != null ? Number(banded.band_score) : null;
  const gap =
    bandLatest != null && bandTarget != null
      ? (bandTarget - bandLatest).toFixed(1)
      : null;

  // Weak areas — агрегируем per_type_breakdown по всем попыткам (без доп. запроса).
  const agg: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    const b = a.per_type_breakdown;
    if (!b) continue;
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      agg[type] = cur;
    }
  }
  const weak = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .map(([type, v]) => ({ type, label: qtypeLabel(type), correct: v.correct, total: v.total }))
    .sort((x, y) => x.correct / x.total - y.correct / y.total)
    .slice(0, 3);
  const weakest = weak[0];

  const progressCopy = gap
    ? null
    : bandLatest != null
      ? "Keep practising to push your band higher."
      : "Take a test to see your current band here.";

  return (
    <AppShell active="dashboard">
      <div style={S.wrap}>
        {/* Top — прогресс + кольцо */}
        <div style={S.split}>
          <div style={{ ...S.card, padding: 34, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={S.eyebrow}>Current progress</div>
            <div style={S.bigBand}>{bandLatest ?? "—"}</div>
            <p style={S.bandLead}>
              {gap ? (
                <>
                  You&apos;re only <strong style={S.strong}>{gap} band</strong> away from your target score of{" "}
                  <strong style={S.strong}>{bandTarget}</strong>.
                </>
              ) : (
                progressCopy
              )}
            </p>
            <div style={{ marginTop: 26 }}>
              <Button size="lg" trailingIcon="arrow-right" href="/app/reading">
                Continue practice
              </Button>
            </div>
          </div>
          <div style={{ ...S.card, padding: 34, display: "grid", placeItems: "center" }}>
            <BandRing current={bandLatest} target={bandTarget} />
          </div>
        </div>

        {/* Stats */}
        <div style={S.stats}>
          <Stat icon="flame" color="var(--streak)" value={streak} label="Day streak" />
          <Stat icon="zap" color="var(--gold-500)" value={fmt(xp)} label="Total XP" />
          <Stat icon="crown" color="var(--brand)" value={rating} label="Rating" />
        </div>

        {/* Weak areas + focus today */}
        {weakest && (
          <div style={S.splitStretch}>
            <div style={{ ...S.card, padding: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <h2 style={S.sectionTitle}>Weak areas</h2>
                <Badge tone="error">Worst first</Badge>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {weak.map((w) => (
                  <SkillBar key={w.type} item={w} />
                ))}
              </div>
            </div>

            <div style={S.focus}>
              <img src="/bando-mark.svg" alt="" aria-hidden="true" style={S.focusMark} />
              <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
                <div style={S.focusEyebrow}>
                  <Icon name="target" size={15} strokeWidth={2.6} /> Focus today
                </div>
                <h2 style={S.focusTitle}>{weakest.label}</h2>
                <p style={S.focusText}>
                  Currently your weakest type — only {weakest.correct} of {weakest.total} right. It has the biggest single impact on your band.
                </p>
                <div style={{ marginTop: "auto", paddingTop: 24 }}>
                  <Button variant="secondary" trailingIcon="arrow-right" href="/app/reading">
                    Fix this weakness
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent tests */}
        <div style={{ ...S.card, padding: "26px 30px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <h2 style={S.sectionTitle}>Recent tests</h2>
            <Link href="/app/reading" style={S.viewAll}>
              View all →
            </Link>
          </div>
          {attempts.length === 0 ? (
            <div style={S.empty}>
              No tests yet. Take your first test from the catalog — your score and per-type breakdown will show up here.
            </div>
          ) : (
            attempts.slice(0, 8).map((a) => <TestRow key={a.id} a={a} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* Band-progress ring — брендовая дуга на светлом треке, тик цели, значение внутри. */
function BandRing({ current, target }: { current: number | null; target: number | null }) {
  const size = 220,
    stroke = 18,
    r = (size - stroke) / 2,
    cx = size / 2,
    C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, (current ?? 0) / 9));
  let tick = null;
  if (target != null) {
    const tAng = (-90 + 360 * (target / 9)) * (Math.PI / 180);
    const tx = cx + r * Math.cos(tAng),
      ty = cx + r * Math.sin(tAng);
    tick = <circle cx={tx} cy={ty} r={7} fill="#fff" stroke="var(--brand-active)" strokeWidth={3} />;
  }
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--violet-100)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
        {tick}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 52, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-0.02em" }}>
            {current ?? "—"}
          </div>
          {target != null && (
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-muted)", marginTop: 8 }}>
              Target <span style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>{target}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, color, value, label }: { icon: IconName; color: string; value: string | number; label: string }) {
  return (
    <div style={{ ...S.card, padding: 22, display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{ width: 48, height: 48, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: `color-mix(in oklab, ${color} 14%, var(--surface))`, color }}>
        <Icon name={icon} size={24} strokeWidth={2.3} />
      </span>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.05 }}>{value}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)", marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

function SkillBar({ item }: { item: { label: string; correct: number; total: number } }) {
  const pct = Math.round((item.correct / item.total) * 100);
  const color = pct < 45 ? "var(--error)" : pct < 65 ? "var(--warn)" : "var(--success)";
  return (
    <Link href="/app/reading" style={{ display: "block", width: "100%", textDecoration: "none", color: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)" }}>{item.label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
          {item.correct} / {item.total}
        </span>
      </div>
      <div style={{ height: 10, background: "var(--surface-inset)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "var(--radius-full)" }} />
      </div>
    </Link>
  );
}

function TestRow({ a }: { a: AttemptRow }) {
  const t = total(a.per_type_breakdown);
  const band = a.band_score != null ? Number(a.band_score) : null;
  const score = a.raw_score != null && t ? `${a.raw_score} / ${t}` : a.raw_score != null ? String(a.raw_score) : "—";
  const meta = `${a.content_item ? categoryLabel(a.content_item.category) : ""}${a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleDateString("en-US")}` : ""}`;
  return (
    <Link href={`/app/reading/${a.content_item_id}/result?a=${a.id}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--border-subtle)", textDecoration: "none", color: "inherit" }}>
      <span style={{ width: 40, height: 40, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--brand-subtle)", color: "var(--brand)" }}>
        <Icon name="book-open" size={19} strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {a.content_item?.title ?? "Test"}
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{meta}</div>
      </div>
      {band != null && (
        <Badge tone="brand" mono>
          band {band}
        </Badge>
      )}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-primary)", minWidth: 64, textAlign: "right" }}>{score}</span>
    </Link>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", padding: "32px 28px 56px", display: "flex", flexDirection: "column", gap: 22 },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-sm)",
  },
  split: { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 22 },
  splitStretch: { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 22, alignItems: "stretch" },
  eyebrow: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--brand)",
  },
  bigBand: { fontFamily: "var(--font-mono)", fontSize: 88, fontWeight: 600, lineHeight: 1, color: "var(--text-primary)", letterSpacing: "-0.03em", margin: "14px 0 0" },
  bandLead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", lineHeight: 1.5, color: "var(--text-muted)", margin: "16px 0 0", maxWidth: 420 },
  strong: { color: "var(--text-primary)", fontWeight: 700 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 22 },
  sectionTitle: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xl)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-tight)",
    color: "var(--text-primary)",
    margin: 0,
    whiteSpace: "nowrap",
  },
  focus: {
    borderRadius: "var(--radius-xl)",
    padding: 32,
    position: "relative",
    overflow: "hidden",
    background: "linear-gradient(150deg, var(--brand) 0%, var(--brand-active) 100%)",
    boxShadow: "var(--shadow-md)",
    display: "flex",
    flexDirection: "column",
  },
  focusMark: { position: "absolute", right: -30, bottom: -30, width: 200, height: 200, opacity: 0.12, pointerEvents: "none" },
  focusEyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.8)",
  },
  focusTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "#fff", margin: "12px 0 0" },
  focusText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", lineHeight: 1.55, color: "rgba(255,255,255,0.85)", margin: "10px 0 0", textWrap: "pretty" },
  viewAll: { marginLeft: "auto", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, textDecoration: "none" },
  empty: {
    padding: "1.5rem 0 2rem",
    textAlign: "center",
    color: "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
  },
};
