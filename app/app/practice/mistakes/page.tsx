import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOpenMistakes, type OpenMistake } from "@/lib/practice/mistakes";
import { qtypeLabel } from "@/lib/labels";
import { Icon } from "@/components/core/icons";
import { AppShell } from "../../_AppShell";
import { MarkLearnedButton } from "./MarkLearnedButton";

export const dynamic = "force-dynamic";

/**
 * `/app/practice/mistakes` — очередь ошибок (P9-rich «вариант B»). Server-компонент:
 * auth → getOpenMistakes (owner-path, деривация из review-snapshot). В клиент уходят
 * только безопасные поля (инвариант 2); правильный ответ пользователь смотрит через
 * practice-reveal на самом тесте, не здесь. Две кнопки на карточку: «Practise this
 * question» (deep-link P15) и «Mark learned» (owner-path резолюция).
 */
export default async function MistakesPage() {
  const user = await requireUser();
  const mistakes = await getOpenMistakes(user.id, { limit: 50 });

  return (
    <AppShell active="practice">
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 64px" }}>
        <Link href="/app/practice" style={S.back}>
          <Icon name="arrow-left" size={16} strokeWidth={2.4} /> Practice
        </Link>
        <h1 style={S.h1}>Review your mistakes</h1>
        <p style={S.sub}>
          Every question you got wrong, newest first. Practise it again or mark it learned to
          clear it from the queue.
        </p>

        {mistakes.length === 0 ? (
          <div style={S.empty}>
            <Icon name="check" size={26} strokeWidth={2.4} style={{ color: "var(--success, var(--brand))" }} />
            <div style={S.emptyTitle}>No open mistakes — nice work</div>
            <div style={S.emptyText}>
              Finish a practice or mock test and any wrong answers will show up here to drill.
            </div>
          </div>
        ) : (
          <ul style={S.list}>
            {mistakes.map((m) => (
              <MistakeCard key={`${m.contentItemId}:${m.questionNumber}`} m={m} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

function MistakeCard({ m }: { m: OpenMistake }) {
  const section = m.section === "listening" ? "Listening" : "Reading";
  // Каталожное правило (app/app/practice/page.tsx examHref): runner-тесты идут через
  // диспетчер /app/exam — он сам решает, атомизированный раннер или practice-lite
  // iframe (2 listening без audio_path), и протаскивает focus в redirect.
  const practiseHref = m.hasRunner
    ? `/app/exam/${m.contentItemId}?mode=practice&focus=${m.questionNumber}`
    : `/app/reading/${m.contentItemId}?mode=practice&focus=${m.questionNumber}`;
  return (
    <li style={S.card}>
      <div style={S.metaRow}>
        <span style={S.sectionPill}>{section}</span>
        <span style={S.qtype}>{qtypeLabel(m.qtype)}</span>
        <span style={S.date}>{DATE_FMT.format(m.submittedAt)}</span>
      </div>
      <div style={S.title}>{m.title}</div>
      <div style={S.qLabel}>Question {m.questionNumber}</div>
      <div style={S.actions}>
        <Link href={practiseHref} style={S.practiceBtn}>
          <Icon name="target" size={16} strokeWidth={2.4} /> Practise this question
        </Link>
        <MarkLearnedButton contentItemId={m.contentItemId} questionNumber={m.questionNumber} />
      </div>
    </li>
  );
}

const S: Record<string, React.CSSProperties> = {
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    textDecoration: "none",
    marginBottom: 14,
  },
  h1: {
    fontFamily: "var(--font-display, var(--font-ui))",
    fontSize: "var(--text-2xl)",
    fontWeight: 800,
    color: "var(--text-primary)",
    margin: 0,
  },
  sub: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    color: "var(--text-secondary)",
    margin: "8px 0 24px",
    maxWidth: 560,
    lineHeight: 1.55,
  },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  card: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--surface-raised)",
    padding: "16px 18px",
  },
  metaRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  sectionPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "var(--radius-sm)",
    background: "var(--brand-subtle)",
    color: "var(--brand)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-2xs)",
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  qtype: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" },
  date: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" },
  title: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-primary)" },
  qLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 },
  practiceBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 44,
    padding: "0 16px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--brand)",
    color: "var(--text-on-brand)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    textDecoration: "none",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 8,
    padding: "56px 24px",
    border: "1px dashed var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    background: "var(--surface-inset, transparent)",
  },
  emptyTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)", fontWeight: 800, color: "var(--text-primary)" },
  emptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", maxWidth: 420, lineHeight: 1.55 },
};
