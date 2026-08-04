import type { Metadata } from "next";
import { headers } from "next/headers";
import { publicSiteUrl } from "@/env";
import { getProfile, requireUser } from "@/lib/auth";
import { effectiveTier, mockWeeklyLimit, REFERRAL_MOCK_BONUS_MAX, type Tier } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import InviteLink from "./InviteLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invite friends | bando" };

interface ReferralRow {
  status: "sent" | "registered" | "rewarded";
}

export default async function InvitePage() {
  await requireUser();
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();
  const profile = await getProfile();
  const supabase = await createClient();

  // Invite URL anchored to the trusted public origin when configured
  // (NEXT_PUBLIC_SITE_URL); otherwise fall back to the request host. Anchoring
  // avoids emitting links to a spoofed Host under a non-standard proxy.
  let base = publicSiteUrl();
  if (!base) {
    const h = await headers();
    const host = h.get("host");
    const proto = host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https";
    base = `${proto}://${host}`;
  }
  const url = `${base}/auth?ref=${profile?.referral_code ?? ""}`;

  // referral has OWNER read RLS (inviter_id = auth.uid()) — only the user's own
  // invites. 'rewarded' = invitee finished >=1 test and the bonus fired.
  const { data } = await supabase.from("referral").select("status");
  const rows = (data ?? []) as ReferralRow[];
  const invited = rows.length;
  const activated = rows.filter((r) => r.status === "rewarded").length;

  // Что реально даёт награда прямо сейчас (G1-1): у Basic — поднятый недельный кап
  // mock-стартов, у платных тиров кап не применяется вовсе, и обещать им «+1» было
  // бы враньём. Считаем ту же формулу, что и гейт (mockWeeklyLimit).
  const tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const bonus = (profile as { referral_cap_bonus?: number } | null)?.referral_cap_bonus ?? 0;
  const mockLimitLabel =
    tier === "basic" ? `${mockWeeklyLimit(bonus)}/week` : "unlimited";

  return (
    <AppShell active="profile">
      <style>{`.inv-wrap{padding:22px 16px 40px}.inv-card{padding:20px}@media(min-width:560px){.inv-wrap{padding:30px 28px 48px}.inv-card{padding:28px}}.mob-back{display:none}@media(max-width:430px){.mob-back{display:block;margin-bottom:10px}}`}</style>
      <div className="inv-wrap" style={S.wrap}>
        {/* Мобильный путь назад — на &le;430px бургер единственный выход. */}
        <div className="mob-back">
          <Button variant="ghost" size="sm" icon="arrow-left" href="/app">Home</Button>
        </div>
        <h1 style={S.h1}>Invite a friend</h1>
        <p style={S.lead}>Once a friend finishes their first test, you both get an extra mock test every week — for good.</p>

        <div className="inv-card" style={S.invite}>
          <div aria-hidden="true" style={S.glow} />
          <div style={{ position: "relative" }}>
            <div style={S.titleRow}>
              <Icon name="trophy" size={20} style={{ color: "var(--violet-300)" }} />
              <span style={S.title}>Your invite link</span>
            </div>
            <p style={S.text}>
              Every friend who finishes their first test raises your weekly mock limit by <b style={{ color: "var(--surface-premium-ink)" }}>+1</b> — theirs too — up to <b style={{ color: "var(--surface-premium-ink)" }}>+{REFERRAL_MOCK_BONUS_MAX}</b>. You also earn +100 XP, they get +50 XP to start.
            </p>
            <InviteLink url={url} />
            <div style={S.stats}>
              Invited: {invited} · Activated: {activated} · Mock starts: {mockLimitLabel}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" },
  lead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 20px" },
  invite: { position: "relative", overflow: "hidden", background: "linear-gradient(160deg, var(--surface-premium), var(--surface-premium-deep))", borderRadius: "var(--radius-xl)", color: "var(--surface-premium-ink)" },
  glow: { position: "absolute", top: -90, right: -70, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 50%, transparent), transparent 64%)" },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  title: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-lg)" },
  text: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.68)", margin: "0 0 4px", maxWidth: 460 },
  stats: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.8)" },
};
