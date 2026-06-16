import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import { Icon, type IconName } from "@/components/core/icons";

export const dynamic = "force-dynamic";

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

const TIER_LABEL: Record<Tier, string> = { basic: "Basic", premium: "Premium", ultra: "Ultra" };
const STATUS_LABEL: Record<PaymentRow["status"], string> = {
  pending: "Pending",
  completed: "Paid",
  failed: "Failed",
};

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

  // payment / attempt / region — все RLS owner-scoped (или public для region).
  const [{ count: testsTaken }, { data: bandTop }, { data: paymentData }, regionName] =
    await Promise.all([
      supabase.from("attempt").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      supabase
        .from("attempt")
        .select("band_score")
        .eq("status", "submitted")
        .not("band_score", "is", null)
        .order("band_score", { ascending: false })
        .limit(1),
      supabase
        .from("payment")
        .select("id,provider,tier,period_months,amount,currency,status,created_at")
        .order("created_at", { ascending: false }),
      (async () => {
        if (!profile?.region_id) return null;
        const { data } = await supabase.from("region").select("name").eq("id", profile.region_id).single();
        return data?.name ?? null;
      })(),
    ]);

  const payments = (paymentData ?? []) as PaymentRow[];
  const bestBand = bandTop?.[0]?.band_score != null ? Number(bandTop[0].band_score) : null;
  const memberSince = profile?.created_at ? new Date(profile.created_at).getFullYear() : null;
  const subLine = [regionName, memberSince ? `Member since ${memberSince}` : null].filter(Boolean).join(" · ");

  return (
    <AppShell active="profile">
      <div style={S.wrap}>
        {/* Header */}
        <div style={S.head}>
          <div style={S.avatar}>{initials((profile?.display_name ?? "") as string, profile?.email ?? user.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={S.h1}>{profile?.display_name ?? profile?.email ?? "—"}</h1>
              <Badge tone={current === "basic" ? "neutral" : "brand"}>{TIER_LABEL[current]}</Badge>
            </div>
            {subLine && <div style={S.subLine}>{subLine}</div>}
          </div>
        </div>

        {/* Lifetime stats */}
        <div style={S.statsBar}>
          <Stat value={testsTaken ?? 0} label="Tests taken" />
          <div style={S.statDiv} />
          <Stat value={bestBand ?? "—"} label="Best band" tone="var(--brand)" />
          <div style={S.statDiv} />
          <Stat value={profile?.current_streak ?? 0} label="Day streak" tone="var(--streak)" />
          <div style={S.statDiv} />
          <Stat value={profile?.rating ?? 1000} label="Rating" />
        </div>

        <div style={S.cols}>
          {/* Account */}
          <div style={S.card}>
            <div style={S.cardTitle}>Account</div>
            <GoalRow icon="book-open" label="Email">
              <span style={S.rowValue}>{profile?.email ?? user.email ?? "—"}</span>
            </GoalRow>
            <GoalRow icon="bar-chart" label="Target band">
              {profile?.target_band != null ? (
                <Badge tone="brand" mono>{Number(profile.target_band)}</Badge>
              ) : (
                <span style={S.rowMuted}>Not set</span>
              )}
            </GoalRow>
            <GoalRow icon="crown" label="Plan">
              <Badge tone={current === "basic" ? "neutral" : "brand"}>{TIER_LABEL[current]}</Badge>
            </GoalRow>
            <div style={{ ...S.goalRow, borderBottom: "none" }}>
              <span style={S.goalIcon}><Icon name="clock" size={17} /></span>
              <span style={S.goalLabel}>Subscription until</span>
              <span style={S.rowValue}>{current === "basic" ? "—" : formatDate(profile?.premium_until ?? null)}</span>
            </div>
            <div style={{ marginTop: 14 }}>
              <Button href="/app/upgrade" trailingIcon="arrow-right" fullWidth>
                {current === "basic" ? "Upgrade plan" : "Manage plan"}
              </Button>
            </div>
          </div>

          {/* Invite */}
          <div style={S.invite}>
            <div aria-hidden="true" style={S.inviteGlow} />
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Icon name="trophy" size={20} style={{ color: "var(--violet-300)" }} />
                <span style={S.inviteTitle}>Invite friends</span>
              </div>
              <p style={S.inviteText}>
                Every friend who finishes their first test gets you <b style={{ color: "#fff" }}>one week of Premium</b> — free.
              </p>
              <Button href="/app/invite" trailingIcon="arrow-right">
                Invite friends
              </Button>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <h2 style={S.h2}>Payment history</h2>
        {payments.length === 0 ? (
          <div style={S.empty}>No payments yet.</div>
        ) : (
          <div style={S.list}>
            {payments.map((p) => (
              <div key={p.id} style={S.payRow}>
                <div>
                  <div style={S.payTitle}>
                    {(TIER_LABEL[p.tier as Tier] ?? p.tier)} · {p.period_months} mo.
                  </div>
                  <div style={S.payMeta}>
                    {p.provider} · {formatDate(p.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={S.payAmount}>
                    {formatAmount(p.amount)} {p.currency}
                  </div>
                  <span style={S.payStatus}>
                    <Badge tone={p.status === "completed" ? "success" : p.status === "failed" ? "error" : "neutral"}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "14px 8px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: 600, color: tone || "var(--text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function GoalRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div style={S.goalRow}>
      <span style={S.goalIcon}><Icon name={icon} size={17} /></span>
      <span style={S.goalLabel}>{label}</span>
      {children}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 820, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", alignItems: "center", gap: 20, marginBottom: 22 },
  avatar: { width: 76, height: 76, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(165deg, var(--brand), var(--brand-active))", color: "var(--text-on-brand)", fontFamily: "var(--font-ui)", fontSize: 28, fontWeight: 800, boxShadow: "var(--shadow-md)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  subLine: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3 },

  statsBar: { display: "flex", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", marginBottom: 16 },
  statDiv: { width: 1, background: "var(--border-subtle)" },

  cols: { display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 16, alignItems: "start" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "8px 20px 16px" },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", padding: "14px 0 4px" },
  goalRow: { display: "flex", alignItems: "center", gap: 13, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" },
  goalIcon: { width: 36, height: 36, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface-inset)", color: "var(--text-secondary)" },
  goalLabel: { flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" },
  rowValue: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 },
  rowMuted: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },

  invite: { position: "relative", overflow: "hidden", background: "linear-gradient(160deg, #2A2342, #14101F)", borderRadius: "var(--radius-xl)", padding: 24, color: "#fff" },
  inviteGlow: { position: "absolute", top: -90, right: -70, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 50%, transparent), transparent 64%)" },
  inviteTitle: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-lg)", whiteSpace: "nowrap" },
  inviteText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.68)", margin: "0 0 18px", maxWidth: 420 },

  h2: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "26px 0 12px" },
  empty: { padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  payRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 15px" },
  payTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  payMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 },
  payAmount: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  payStatus: { display: "inline-flex", marginTop: 4 },
};
