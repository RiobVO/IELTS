import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { PLANS } from "@/lib/payments/plans";
import { initiatePayment } from "./actions";

export const dynamic = "force-dynamic";

// Строки §4.8: сравнение фич по тарифам. Значения — ровно из таблицы брифа,
// порядок колонок basic < premium < ultra.
const FEATURES: { label: string; basic: string; premium: string; ultra: string }[] = [
  {
    label: "Reading/Listening по passage/part",
    basic: "Ограниченно (N/день)",
    premium: "Безлимит",
    ultra: "Безлимит",
  },
  {
    label: "Full-тесты (40 вопросов)",
    basic: "1 пробный",
    premium: "Да",
    ultra: "Да",
  },
  {
    label: "Разбор + evidence после сдачи",
    basic: "Базовый",
    premium: "Полный",
    ultra: "Полный",
  },
  {
    label: "Аналитика по типам + история",
    basic: "7 дней",
    premium: "Полная",
    ultra: "Полная",
  },
  {
    label: "Лидерборд (рейтинг, регионы)",
    basic: "Просмотр",
    premium: "Участие",
    ultra: "Участие",
  },
  { label: "Бейджи / стрики", basic: "Да", premium: "Да", ultra: "Да" },
  {
    label: "AI-оценка Writing/Speaking",
    basic: "—",
    premium: "—",
    ultra: "Скоро",
  },
];

const TIER_LABEL: Record<Tier, string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};
const PROVIDERS = ["payme", "click", "uzum"] as const;

/** Цена в суммах (минорные единицы tiyin -> UZS) для отображения. */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount / 100));
}

export default async function UpgradePage() {
  await requireUser();
  const profile = await getProfile();
  const current: Tier = profile
    ? effectiveTier({ tier: profile.tier, premium_until: profile.premium_until })
    : "basic";

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>
        <h1 style={S.h1}>Тарифы</h1>
        <p style={S.sub}>
          Текущий тариф: <strong>{TIER_LABEL[current]}</strong>. Premium и Ultra
          открывают безлимит, полный разбор и аналитику.
        </p>

        {/* Сравнение фич §4.8 */}
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left" }}>Фича</th>
                <th style={S.th}>Basic</th>
                <th style={S.th}>Premium</th>
                <th style={S.th}>Ultra</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.label}>
                  <td style={{ ...S.td, textAlign: "left", fontWeight: 600 }}>
                    {f.label}
                  </td>
                  <td style={S.td}>{f.basic}</td>
                  <td style={S.td}>{f.premium}</td>
                  <td style={S.td}>{f.ultra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Планы покупки */}
        <h2 style={S.h2}>Оформить подписку</h2>
        <div style={S.plans}>
          {PLANS.map((plan) => (
            <div key={`${plan.tier}-${plan.months}`} style={S.planCard}>
              <div style={S.planTier}>{TIER_LABEL[plan.tier as Tier]}</div>
              <div style={S.planPeriod}>
                {plan.months}{" "}
                {plan.months === 1 ? "месяц" : plan.months < 5 ? "месяца" : "месяцев"}
              </div>
              <div style={S.planPrice}>
                {formatAmount(plan.amount)} {plan.currency ?? "UZS"}
              </div>
              <form action={initiatePayment} style={S.planForm}>
                <input type="hidden" name="tier" value={plan.tier} />
                <input type="hidden" name="months" value={plan.months} />
                <label style={S.label}>
                  Провайдер
                  <select name="provider" style={S.select} defaultValue="payme">
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" style={S.buy}>
                  Оформить
                </button>
              </form>
            </div>
          ))}
        </div>

        <p style={S.note}>
          Оплата через Payme, Click и Uzum. Пока работает песочница без реальных
          ключей провайдеров (§10) — платёж завершается на тестовой странице.
        </p>
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 880, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.8rem", margin: ".5rem 0 .25rem" },
  sub: { color: "#555", margin: "0 0 1.5rem" },
  tableWrap: { overflowX: "auto", border: "1px solid #ececf1", borderRadius: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: ".88rem" },
  th: {
    padding: ".7rem .8rem",
    background: "#f7f7fb",
    color: "#0f172a",
    fontWeight: 700,
    fontSize: ".82rem",
    textAlign: "center",
    borderBottom: "1px solid #ececf1",
  },
  td: {
    padding: ".65rem .8rem",
    textAlign: "center",
    color: "#444",
    borderBottom: "1px solid #f2f2f6",
  },
  h2: { fontSize: "1.2rem", margin: "1.75rem 0 .9rem" },
  plans: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: ".9rem",
  },
  planCard: {
    border: "1px solid #ececf1",
    borderRadius: 14,
    padding: "1.2rem",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,.03)",
  },
  planTier: { fontWeight: 800, fontSize: "1.1rem", color: "#5a44d6" },
  planPeriod: { color: "#888", fontSize: ".85rem", marginTop: ".15rem" },
  planPrice: { fontSize: "1.5rem", fontWeight: 800, margin: ".6rem 0 .9rem" },
  planForm: { display: "grid", gap: ".6rem" },
  label: {
    display: "grid",
    gap: ".25rem",
    fontSize: ".78rem",
    color: "#666",
    fontWeight: 600,
  },
  select: {
    padding: ".55rem .6rem",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: ".9rem",
    background: "#fff",
  },
  buy: {
    padding: ".7rem",
    border: "none",
    borderRadius: 8,
    background: "#6C5CE7",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  note: { color: "#999", fontSize: ".82rem", marginTop: "1.5rem" },
};
