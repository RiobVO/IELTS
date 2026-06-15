import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/labels";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";

type Breakdown = Record<string, { correct: number; total: number }> | null;

interface AttemptRow {
  id: string;
  content_item_id: string;
  raw_score: number | null;
  per_type_breakdown: Breakdown;
  submitted_at: string | null;
  content_item: { title: string; category: string } | null;
}

function total(b: Breakdown): number {
  if (!b) return 0;
  return Object.values(b).reduce((s, x) => s + x.total, 0);
}

export default async function Dashboard() {
  await requireUser();
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("attempt")
      .select(
        "id,content_item_id,raw_score,per_type_breakdown,submitted_at,content_item:content_item_id(title,category)",
      )
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(20),
    // Непрочитанные уведомления (RLS notification_select_own) — счётчик в навигации.
    supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);
  const attempts = (data ?? []) as unknown as AttemptRow[];
  const unread = unreadCount ?? 0;

  const completed = attempts.length;
  const avg =
    completed > 0
      ? Math.round(
          (attempts.reduce((s, a) => {
            const t = total(a.per_type_breakdown);
            return s + (t ? (a.raw_score ?? 0) / t : 0);
          }, 0) /
            completed) *
            100,
        )
      : 0;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <div style={S.top}>
          <div>
            <h1 style={S.h1}>Дашборд</h1>
            <p style={S.hi}>
              {profile?.display_name ?? profile?.email} ·{" "}
              <span style={S.muted}>
                {profile?.role} · {profile?.tier}
              </span>
            </p>
          </div>
          <form action={signOut}>
            <button type="submit" style={S.signout}>
              Выйти
            </button>
          </form>
        </div>

        <div style={S.stats}>
          <Stat value={completed} label="Тестов пройдено" />
          <Stat value={`${avg}%`} label="Средний результат" />
          <Stat value={profile?.rating ?? 1000} label="Рейтинг" />
        </div>

        <div style={S.ctaRow}>
          <Link href="/app/reading" style={S.cta}>
            Reading — каталог тестов →
          </Link>
          <Link href="/app/listening" style={S.cta}>
            Listening — каталог тестов →
          </Link>
          <Link href="/app/leaderboard" style={S.ctaSecondary}>
            Лидерборд →
          </Link>
          <Link href="/app/badges" style={S.ctaSecondary}>
            Бейджи →
          </Link>
          <Link href="/app/invite" style={S.ctaSecondary}>
            Пригласить →
          </Link>
          <Link href="/app/notifications" style={S.ctaSecondary}>
            Уведомления{unread > 0 ? ` (${unread})` : ""} →
          </Link>
        </div>

        <h2 style={S.h2}>История</h2>
        {attempts.length === 0 ? (
          <div style={S.empty}>
            Ещё нет попыток. Пройди первый тест из каталога — здесь появится
            результат и разбивка по типам.
          </div>
        ) : (
          <div style={S.list}>
            {attempts.map((a) => {
              const t = total(a.per_type_breakdown);
              const pct = t ? Math.round(((a.raw_score ?? 0) / t) * 100) : 0;
              return (
                <Link
                  key={a.id}
                  href={`/app/reading/${a.content_item_id}/result?a=${a.id}`}
                  style={S.row}
                >
                  <div>
                    <div style={S.rowTitle}>
                      {a.content_item?.title ?? "Тест"}
                    </div>
                    <div style={S.rowMeta}>
                      {a.content_item
                        ? categoryLabel(a.content_item.category)
                        : ""}{" "}
                      ·{" "}
                      {a.submitted_at
                        ? new Date(a.submitted_at).toLocaleDateString("ru-RU")
                        : ""}
                    </div>
                  </div>
                  <div style={S.rowScore}>
                    {a.raw_score}/{t}{" "}
                    <span style={{ color: "#999", fontWeight: 600 }}>
                      ({pct}%)
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statValue}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 720, margin: "0 auto" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  h1: { fontSize: "1.7rem", margin: 0 },
  hi: { color: "#444", margin: ".3rem 0 0" },
  muted: { color: "#999" },
  signout: {
    padding: ".5rem .9rem",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
  },
  stats: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: ".75rem", margin: "1.5rem 0" },
  stat: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1rem",
    textAlign: "center",
  },
  statValue: { fontSize: "1.8rem", fontWeight: 800, color: "#0f172a" },
  statLabel: { color: "#888", fontSize: ".78rem", marginTop: ".2rem" },
  ctaRow: { display: "flex", flexWrap: "wrap", gap: ".6rem" },
  cta: {
    display: "inline-block",
    padding: ".7rem 1.1rem",
    background: "#6C5CE7",
    color: "#fff",
    borderRadius: 10,
    fontWeight: 700,
  },
  ctaSecondary: {
    display: "inline-block",
    padding: ".7rem 1.1rem",
    background: "#fff",
    color: "#6C5CE7",
    border: "1px solid #6C5CE7",
    borderRadius: 10,
    fontWeight: 700,
  },
  h2: { fontSize: "1.15rem", margin: "1.75rem 0 .75rem" },
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
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    color: "inherit",
  },
  rowTitle: { fontWeight: 700, fontSize: ".95rem" },
  rowMeta: { color: "#999", fontSize: ".78rem", marginTop: ".15rem" },
  rowScore: { fontWeight: 800, fontSize: "1rem" },
};
