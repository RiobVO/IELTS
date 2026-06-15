import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTier, type Tier } from "@/lib/tiers";

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

const TIER_LABEL: Record<Tier, string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};
const STATUS_LABEL: Record<PaymentRow["status"], string> = {
  pending: "В ожидании",
  completed: "Оплачен",
  failed: "Ошибка",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Сумма в суммах (минорные tiyin -> UZS). */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount / 100));
}

export default async function ProfilePage() {
  await requireUser();
  const profile = await getProfile();
  const supabase = await createClient();

  const current: Tier = profile
    ? effectiveTier({ tier: profile.tier, premium_until: profile.premium_until })
    : "basic";

  // payment имеет owner SELECT RLS (user_id = auth.uid()), поэтому anon-клиент
  // вернёт только собственные платежи пользователя.
  const { data } = await supabase
    .from("payment")
    .select(
      "id,provider,tier,period_months,amount,currency,status,created_at",
    )
    .order("created_at", { ascending: false });
  const payments = (data ?? []) as PaymentRow[];

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>
        <h1 style={S.h1}>Профиль</h1>

        <div style={S.card}>
          <Row label="Имя" value={profile?.display_name ?? "—"} />
          <Row label="Email" value={profile?.email ?? "—"} />
          <Row label="Тариф" value={TIER_LABEL[current]} />
          <Row
            label="Подписка до"
            value={current === "basic" ? "—" : formatDate(profile?.premium_until ?? null)}
          />
        </div>

        <Link href="/app/upgrade" style={S.cta}>
          Сменить тариф →
        </Link>

        <h2 style={S.h2}>История платежей</h2>
        {payments.length === 0 ? (
          <div style={S.empty}>Платежей пока нет.</div>
        ) : (
          <div style={S.list}>
            {payments.map((p) => (
              <div key={p.id} style={S.row2}>
                <div>
                  <div style={S.rowTitle}>
                    {TIER_LABEL[p.tier as Tier] ?? p.tier} · {p.period_months} мес.
                  </div>
                  <div style={S.rowMeta}>
                    {p.provider} · {formatDate(p.created_at)}
                  </div>
                </div>
                <div style={S.rowRight}>
                  <div style={S.amount}>
                    {formatAmount(p.amount)} {p.currency}
                  </div>
                  <span style={{ ...S.status, ...statusStyle(p.status) }}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.row}>
      <span style={S.rowLabel}>{label}</span>
      <span style={S.rowValue}>{value}</span>
    </div>
  );
}

function statusStyle(status: PaymentRow["status"]): React.CSSProperties {
  if (status === "completed") return { background: "#eafaef", color: "#137a3a" };
  if (status === "failed") return { background: "#fdecec", color: "#a11" };
  return { background: "#f1eefe", color: "#4b3fb0" };
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 640, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.8rem", margin: ".5rem 0 1.25rem" },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1.1rem 1.25rem",
    marginBottom: "1rem",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: ".45rem 0",
    borderBottom: "1px solid #f2f2f6",
  },
  rowLabel: { color: "#888", fontSize: ".9rem" },
  rowValue: { fontWeight: 700, fontSize: ".9rem" },
  cta: {
    display: "inline-block",
    padding: ".7rem 1.1rem",
    background: "#6C5CE7",
    color: "#fff",
    borderRadius: 10,
    fontWeight: 700,
  },
  h2: { fontSize: "1.2rem", margin: "1.75rem 0 .75rem" },
  empty: {
    padding: "1.5rem",
    textAlign: "center",
    color: "#999",
    border: "1px dashed #ddd",
    borderRadius: 12,
    fontSize: ".9rem",
  },
  list: { display: "grid", gap: ".5rem" },
  row2: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    background: "#fff",
  },
  rowTitle: { fontWeight: 700, fontSize: ".95rem" },
  rowMeta: { color: "#999", fontSize: ".78rem", marginTop: ".15rem" },
  rowRight: { textAlign: "right" },
  amount: { fontWeight: 800, fontSize: ".95rem" },
  status: {
    display: "inline-block",
    fontSize: ".72rem",
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 6,
    marginTop: ".25rem",
  },
};
