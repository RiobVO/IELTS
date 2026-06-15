import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

  // notification: RLS notification_select_own (0001) — возвращает только свои.
  const { data } = await supabase
    .from("notification")
    .select("id,type,title,body,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const items = (data ?? []) as NotificationRow[];
  const unread = items.filter((n) => n.read_at === null).length;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>

        <div style={S.head}>
          <h1 style={S.h1}>Уведомления</h1>
          {unread > 0 && (
            <form action={markAllRead}>
              <button type="submit" style={S.markBtn}>
                Отметить всё прочитанным
              </button>
            </form>
          )}
        </div>

        {items.length === 0 ? (
          <div style={S.empty}>
            Пока нет уведомлений. Проходи тесты — здесь появятся разблокированные
            бейджи, напоминания о стрике и недельный дайджест.
          </div>
        ) : (
          <div style={S.list}>
            {items.map((n) => (
              <div
                key={n.id}
                style={n.read_at ? S.row : { ...S.row, ...S.rowUnread }}
              >
                <div style={S.rowTop}>
                  <span style={S.rowTitle}>{n.title}</span>
                  {n.read_at === null && <span style={S.dot} />}
                </div>
                {n.body && <div style={S.body}>{n.body}</div>}
                <div style={S.meta}>
                  {new Date(n.created_at).toLocaleDateString("ru-RU")}
                </div>
              </div>
            ))}
          </div>
        )}
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
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    margin: "1rem 0 1.5rem",
    gap: "1rem",
  },
  h1: { fontSize: "1.7rem", margin: 0 },
  markBtn: {
    padding: ".5rem .9rem",
    border: "1px solid #6C5CE7",
    borderRadius: 8,
    background: "#fff",
    color: "#6C5CE7",
    fontWeight: 700,
    fontSize: ".82rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "1.5rem",
    textAlign: "center",
    color: "#999",
    border: "1px dashed #ddd",
    borderRadius: 12,
    fontSize: ".9rem",
  },
  list: { display: "grid", gap: ".5rem" },
  row: {
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    background: "#fff",
  },
  rowUnread: { borderColor: "#6C5CE7", background: "#f6f5ff" },
  rowTop: { display: "flex", alignItems: "center", gap: ".5rem" },
  rowTitle: { fontWeight: 700, fontSize: ".95rem" },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#6C5CE7",
    display: "inline-block",
  },
  body: { color: "#555", fontSize: ".85rem", marginTop: ".3rem", lineHeight: 1.4 },
  meta: { color: "#999", fontSize: ".75rem", marginTop: ".4rem" },
};
