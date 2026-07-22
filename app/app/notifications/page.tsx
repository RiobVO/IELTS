import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { markAllRead } from "./actions";

export const dynamic = "force-dynamic";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export default async function NotificationsPage() {
  await requireUser();
  const supabase = await createClient();

  // notification: RLS notification_select_own (0001) — only the user's own rows.
  const { data } = await supabase
    .from("notification")
    .select("id,type,title,body,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const items = (data ?? []) as NotificationRow[];
  const unread = items.filter((n) => n.read_at === null).length;

  return (
    <AppShell active="notifications">
      <div style={S.wrap}>
        <div style={S.head}>
          <h1 style={S.h1}>Notifications</h1>
          {unread > 0 && (
            <form action={markAllRead}>
              <Button type="submit" variant="secondary" size="sm">
                Mark all read
              </Button>
            </form>
          )}
        </div>

        {items.length === 0 ? (
          <div style={S.empty}>
            No notifications yet. Keep practising — unlocked badges, streak reminders and the weekly digest will land here.
          </div>
        ) : (
          <div style={S.list}>
            {items.map((n) => {
              const isUnread = n.read_at === null;
              return (
                <div key={n.id} style={{ ...S.row, ...(isUnread ? S.rowUnread : {}) }}>
                  <div style={S.rowTop}>
                    <span style={S.rowTitle}>{n.title}</span>
                    {isUnread && <span style={S.dot} />}
                  </div>
                  {n.body && <div style={S.body}>{n.body}</div>}
                  <div style={S.meta}>{new Date(n.created_at).toLocaleDateString("en-US")}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 18px", gap: 16 },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  empty: { padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" },
  rowUnread: { borderColor: "var(--brand-border)", background: "var(--brand-subtle)" },
  rowTop: { display: "flex", alignItems: "center", gap: 8 },
  rowTitle: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", display: "inline-block" },
  body: { fontFamily: "var(--font-ui)", color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 4, lineHeight: 1.45 },
  meta: { fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: "var(--text-2xs)", marginTop: 6 },
};
