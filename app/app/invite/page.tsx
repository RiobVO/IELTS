import { headers } from "next/headers";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_AppShell";
import { Icon } from "@/components/core/icons";
import InviteLink from "./InviteLink";

export const dynamic = "force-dynamic";

interface ReferralRow {
  status: "sent" | "registered" | "rewarded";
}

export default async function InvitePage() {
  await requireUser();
  const profile = await getProfile();
  const supabase = await createClient();

  // Build the invite URL from the request host (no env dependency).
  const h = await headers();
  const host = h.get("host");
  const proto = host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https";
  const url = `${proto}://${host}/auth?ref=${profile?.referral_code ?? ""}`;

  // referral has OWNER read RLS (inviter_id = auth.uid()) — only the user's own
  // invites. 'rewarded' = invitee finished >=1 test and the bonus fired.
  const { data } = await supabase.from("referral").select("status");
  const rows = (data ?? []) as ReferralRow[];
  const invited = rows.length;
  const activated = rows.filter((r) => r.status === "rewarded").length;

  return (
    <AppShell active="profile">
      <style>{`.inv-wrap{padding:22px 16px 40px}.inv-card{padding:20px}@media(min-width:560px){.inv-wrap{padding:30px 28px 48px}.inv-card{padding:28px}}`}</style>
      <div className="inv-wrap" style={S.wrap}>
        <h1 style={S.h1}>Invite a friend</h1>
        <p style={S.lead}>Once a friend finishes their first test, you both earn XP.</p>

        <div className="inv-card" style={S.invite}>
          <div aria-hidden="true" style={S.glow} />
          <div style={{ position: "relative" }}>
            <div style={S.titleRow}>
              <Icon name="trophy" size={20} style={{ color: "var(--violet-300)" }} />
              <span style={S.title}>Your invite link</span>
            </div>
            <p style={S.text}>
              Every friend who finishes their first test earns you <b style={{ color: "var(--surface-premium-ink)" }}>+100 XP</b>, and gives them <b style={{ color: "var(--surface-premium-ink)" }}>+50 XP</b> to start.
            </p>
            <InviteLink url={url} />
            <div style={S.stats}>
              Invited: {invited} · Activated: {activated}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 4px" },
  lead: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 20px" },
  invite: { position: "relative", overflow: "hidden", background: "linear-gradient(160deg, var(--surface-premium), var(--surface-premium-deep))", borderRadius: "var(--radius-xl)", color: "var(--surface-premium-ink)" },
  glow: { position: "absolute", top: -90, right: -70, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 50%, transparent), transparent 64%)" },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  title: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: "var(--text-lg)" },
  text: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.68)", margin: "0 0 4px", maxWidth: 460 },
  stats: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "rgba(255,255,255,0.8)" },
};
