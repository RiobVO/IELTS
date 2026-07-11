import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sprintSignup } from "@/db/schema";
import { requireUser, getProfile } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Icon } from "@/components/core/icons";
import { AppShell } from "../_AppShell";
import { joinSprint } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exam sprint | bando" };

/**
 * `/app/sprint` — запись в ручной пилот когорты «спринт к экзамену» (BRIEF §12.3).
 * Пилот полностью ручной: куратор — владелец, вся коммуникация — в Telegram, без
 * автоматизации/уведомлений/крон. Страница нужна только чтобы связать
 * user_id ↔ участие (замер retention) и собрать telegram-хэндл для куратора.
 * Ссылку раздаёт владелец постом в канале — сознательно вне навигации продукта:
 * active="profile" как у /app/invite (вне LINKS в AppHeader → подсветки нет).
 */
export default async function SprintPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();
  const { error } = await searchParams;

  const [profile, signupRows] = await Promise.all([
    getProfile(),
    // Owner-path Drizzle read scoped to the caller's own id — same posture as the
    // server-action write (RLS is owner-read too; this keeps read+write on one path).
    db
      .select({ telegramHandle: sprintSignup.telegramHandle })
      .from(sprintSignup)
      .where(eq(sprintSignup.userId, user.id))
      .limit(1),
  ]);
  const signup = signupRows[0] ?? null;
  const examDate = (profile as { exam_date: string | null } | null)?.exam_date ?? null;

  return (
    <AppShell active="profile">
      <div style={S.wrap}>
        <div style={S.overline}>
          <span style={S.overlineDot} />
          Exam sprint cohort
        </div>
        <h1 style={S.h1}>Exam sprint cohort</h1>
        <p style={S.sub}>
          A guided sprint to your exam date. Small cohort, curated in Telegram by the team —
          you get a daily rhythm and accountability. Free during the pilot.
        </p>

        {signup ? (
          <div style={S.card}>
            <div style={S.doneRow}>
              <Icon name="circle-check" size={22} strokeWidth={2.4} style={{ color: "var(--success-text)" }} />
              <span style={S.doneTitle}>You&apos;re in</span>
            </div>
            <p style={S.handle}>{signup.telegramHandle}</p>
            <p style={S.hint}>We&apos;ll reach out in Telegram before the sprint starts.</p>
          </div>
        ) : (
          <form action={joinSprint} style={S.card}>
            {error && <p style={S.err}>{error}</p>}
            <label htmlFor="telegram_handle" style={S.label}>
              Your Telegram username
            </label>
            <Input
              id="telegram_handle"
              name="telegram_handle"
              placeholder="@username"
              required
              minLength={3}
              maxLength={65}
              autoComplete="off"
              invalid={!!error}
            />
            {!examDate && (
              <p style={S.tip}>
                <Icon name="info" size={14} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }} />
                Tip: set your exam date on the dashboard so the sprint can be paced to it
              </p>
            )}
            <Button type="submit" size="lg" trailingIcon="arrow-right" style={{ marginTop: 4 }}>
              Join the sprint
            </Button>
          </form>
        )}
      </div>
    </AppShell>
  );
}

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 560, margin: "0 auto", padding: "32px 24px 64px" },
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--text-primary)", margin: 0 },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "10px 0 26px", lineHeight: 1.55 },
  card: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface-raised)", padding: "22px 20px" },
  label: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" },
  err: { margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--error-text)", background: "var(--error-subtle)", borderRadius: "var(--radius-md)", padding: "8px 12px" },
  tip: { display: "flex", alignItems: "flex-start", gap: 7, margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.5 },
  doneRow: { display: "flex", alignItems: "center", gap: 9 },
  doneTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-primary)" },
  handle: { margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-primary)" },
  hint: { margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
};
