import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { payment } from "@/db/schema";
import SimulatePayment from "./SimulatePayment";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  premium: "Premium",
  ultra: "Ultra",
};

/** Сумма в суммах (минорные tiyin -> UZS) для показа. */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount / 100));
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pid?: string }>;
}) {
  const user = await requireUser();
  const { pid } = await searchParams;

  // Платёж читаем owner-путём (Drizzle): нужны provider/tier/months/amount, чтобы
  // собрать stub-payload вебхука. Проверяем владельца — чужой pid не открываем.
  const row = pid
    ? (await db.select().from(payment).where(eq(payment.id, pid)).limit(1))[0]
    : undefined;
  const valid = row && row.userId === user.id;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app/upgrade" style={S.back}>
          ← Тарифы
        </Link>
        <h1 style={S.h1}>Оплата (песочница)</h1>

        {!valid ? (
          <div style={S.empty}>
            Платёж не найден. Вернись к{" "}
            <Link href="/app/upgrade" style={S.link}>
              тарифам
            </Link>{" "}
            и оформи заново.
          </div>
        ) : (
          <>
            <div style={S.card}>
              <Row label="Тариф" value={TIER_LABEL[row.tier] ?? row.tier} />
              <Row label="Срок" value={`${row.periodMonths} мес.`} />
              <Row label="Провайдер" value={row.provider} />
              <Row
                label="Сумма"
                value={`${formatAmount(row.amount)} ${row.currency}`}
              />
              <Row label="Статус" value={row.status} />
            </div>

            <p style={S.note}>
              Реальных ключей провайдеров пока нет (§10). Кнопка ниже имитирует
              callback от {row.provider} — отправляет вебхук, который завершает
              платёж и продлевает подписку.
            </p>

            {row.status === "completed" ? (
              <Link href="/app/profile" style={S.cta}>
                Платёж завершён — в профиль →
              </Link>
            ) : (
              <SimulatePayment
                provider={row.provider}
                providerTransactionId={row.providerTransactionId}
              />
            )}
          </>
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

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 520, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.7rem", margin: ".5rem 0 1.25rem" },
  link: { color: "#6C5CE7" },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1.1rem 1.25rem",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: ".45rem 0",
    borderBottom: "1px solid #f2f2f6",
  },
  rowLabel: { color: "#888", fontSize: ".9rem" },
  rowValue: { fontWeight: 700, fontSize: ".9rem" },
  note: { color: "#777", fontSize: ".85rem", margin: "1rem 0 1.25rem" },
  cta: {
    display: "inline-block",
    padding: ".75rem 1.2rem",
    background: "#6C5CE7",
    color: "#fff",
    borderRadius: 10,
    fontWeight: 700,
  },
  empty: {
    padding: "1.5rem",
    textAlign: "center",
    color: "#999",
    border: "1px dashed #ddd",
    borderRadius: 12,
    fontSize: ".9rem",
  },
};
