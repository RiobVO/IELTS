import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { payment } from "@/db/schema";
import { AppShell } from "../../_AppShell";
import { Button } from "@/components/core/Button";
import { Badge } from "@/components/core/Badge";
import SimulatePayment from "./SimulatePayment";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { premium: "Premium", ultra: "Ultra" };

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(amount / 100));
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pid?: string }>;
}) {
  const user = await requireUser();
  const { pid } = await searchParams;

  // Owner-path read (Drizzle): need provider/tier/months/amount to build the stub
  // webhook payload. Ownership-checked — never open someone else's pid.
  const row = pid
    ? (await db.select().from(payment).where(eq(payment.id, pid)).limit(1))[0]
    : undefined;
  const valid = row && row.userId === user.id;

  return (
    <AppShell active="pricing">
      <style>{`.co-wrap{padding:22px 16px 40px}@media(min-width:560px){.co-wrap{padding:30px 28px 48px}}`}</style>
      <div className="co-wrap" style={S.wrap}>
        <h1 style={S.h1}>Checkout (sandbox)</h1>

        {!valid ? (
          <div style={S.empty}>
            Payment not found. Head back to{" "}
            <Link href="/app/upgrade" style={{ color: "var(--text-link)" }}>pricing</Link> and start again.
          </div>
        ) : (
          <>
            <div style={S.card}>
              <Row label="Plan" value={TIER_LABEL[row.tier] ?? row.tier} />
              <Row label="Term" value={`${row.periodMonths} mo.`} />
              <Row label="Provider" value={row.provider} />
              <Row label="Amount" value={`${formatAmount(row.amount)} ${row.currency}`} />
              <div style={{ ...S.row, borderBottom: "none" }}>
                <span style={S.rowLabel}>Status</span>
                <Badge tone={row.status === "completed" ? "success" : "neutral"}>{row.status}</Badge>
              </div>
            </div>

            <p style={S.note}>
              No real provider keys yet (§10). The button below simulates a callback from {row.provider} —
              it posts the webhook that completes the payment and extends the subscription.
            </p>

            {row.status === "completed" ? (
              <Button href="/app/profile" trailingIcon="arrow-right" fullWidth>
                Payment complete — go to profile
              </Button>
            ) : (
              <SimulatePayment provider={row.provider} providerTransactionId={row.providerTransactionId} />
            )}
          </>
        )}
      </div>
    </AppShell>
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

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 520, margin: "0 auto" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "0 0 18px" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "8px 20px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" },
  rowLabel: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)" },
  rowValue: { fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: "var(--text-sm)", color: "var(--text-primary)" },
  note: { fontFamily: "var(--font-ui)", color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "16px 0", lineHeight: 1.5 },
  empty: { padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
};
