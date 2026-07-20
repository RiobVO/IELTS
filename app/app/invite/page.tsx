import Link from "next/link";
import { headers } from "next/headers";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  const proto =
    host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https";
  const url = `${proto}://${host}/auth?ref=${profile?.referral_code ?? ""}`;

  // referral has OWNER read RLS (inviter_id = auth.uid()), so this only ever
  // returns the logged-in user's own invites. We tally statuses in JS;
  // 'registered' + 'rewarded' = activated (the invitee signed up), 'rewarded'
  // = they completed >=1 test and the bonus fired.
  const { data } = await supabase.from("referral").select("status");
  const rows = (data ?? []) as ReferralRow[];
  const invited = rows.length;
  const activated = rows.filter((r) => r.status === "rewarded").length;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>

        <h1 style={S.h1}>Пригласить друга</h1>
        <p style={S.lead}>
          Пригласи друга — после его первого теста вы оба получаете XP.
        </p>

        <div style={S.card}>
          <div style={S.label}>Твоя ссылка-приглашение</div>
          <InviteLink url={url} />
          <div style={S.stats}>
            Приглашено: {invited} · Активировано: {activated}
          </div>
        </div>
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.7rem", margin: "1rem 0 .25rem" },
  lead: { color: "#444", margin: "0 0 1.5rem" },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1.25rem",
  },
  label: { fontWeight: 700, fontSize: ".95rem", color: "#0f172a" },
  stats: { color: "#888", fontSize: ".85rem", fontWeight: 600, marginTop: ".25rem" },
};
