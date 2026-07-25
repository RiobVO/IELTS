import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
import { Icon, type IconName } from "@/components/core/icons";
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

/** Визуальное представление по реальным значениям notification_type (schema). */
interface TypeStyle {
  icon: IconName;
  color: string;
  sub: string;
  label: string;
}
const TYPE: Record<string, TypeStyle> = {
  badge_unlocked: { icon: "award", color: "var(--brand)", sub: "var(--brand-subtle)", label: "Badge" },
  streak_reminder: { icon: "flame", color: "var(--streak)", sub: "var(--streak-subtle)", label: "Streak" },
  weekly_digest: { icon: "bar-chart", color: "var(--info)", sub: "var(--info-subtle)", label: "Digest" },
  system: { icon: "bell", color: "var(--text-muted)", sub: "var(--surface-inset)", label: "System" },
};
const FALLBACK: TypeStyle = { icon: "bell", color: "var(--text-muted)", sub: "var(--surface-inset)", label: "Update" };

/** Относительное время — тот же контракт, что на дашборде (Today / Yesterday / Nd ago / дата). */
function relTime(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { day: "numeric", month: "short" });
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
          {unread > 0 && <span style={S.unreadPill}>{unread} unread</span>}
          {unread > 0 && (
            <form action={markAllRead} style={S.headAction}>
              <Button type="submit" variant="secondary" size="sm">
                Mark all read
              </Button>
            </form>
          )}
        </div>

        {items.length === 0 ? (
          <div style={S.empty}>
            No notifications yet. Keep practising — unlocked badges, streak reminders and the weekly
            digest will land here.
          </div>
        ) : (
          <div style={S.card}>
            {items.map((n, i) => {
              const t = TYPE[n.type] ?? FALLBACK;
              const isUnread = n.read_at === null;
              return (
                <div
                  key={n.id}
                  style={{
                    ...S.row,
                    ...(i < items.length - 1 ? S.rowDivide : {}),
                    ...(isUnread ? S.rowUnread : {}),
                  }}
                >
                  <span style={{ ...S.dot, background: isUnread ? t.color : "transparent" }} />
                  <span style={{ ...S.iconBox, background: t.sub, color: t.color }}>
                    <Icon name={t.icon} size={19} strokeWidth={2.3} />
                  </span>
                  <div style={S.rowMain}>
                    <div
                      style={{
                        ...S.rowTitle,
                        fontWeight: isUnread ? 700 : 600,
                        color: isUnread ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {n.title}
                    </div>
                    {n.body && <div style={S.rowBody}>{n.body}</div>}
                  </div>
                  <span style={{ ...S.chip, color: t.color, background: t.sub }}>{t.label}</span>
                  <span style={S.when}>{relTime(n.created_at)}</span>
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
  wrap: { maxWidth: 680, margin: "0 auto", padding: "34px 28px 56px" },
  head: { display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: 0 },
  unreadPill: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: 999, padding: "3px 10px" },
  headAction: { marginLeft: "auto" },
  empty: { padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)", overflow: "hidden" },
  row: { display: "flex", gap: 13, alignItems: "center", padding: "15px 18px", background: "var(--surface)" },
  rowDivide: { borderBottom: "1px solid var(--border-subtle)" },
  rowUnread: { background: "color-mix(in oklab, var(--brand) 4%, var(--surface))" },
  dot: { flex: "none", width: 8, height: 8, borderRadius: "50%" },
  iconBox: { flex: "none", width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center" },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowBody: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 },
  chip: { flex: "none", fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", borderRadius: 999, padding: "3px 9px" },
  when: { flex: "none", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", width: 64, textAlign: "right" },
};
