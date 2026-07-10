import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { getOpenMistakes, type OpenMistake } from "@/lib/practice/mistakes";
import { qtypeLabel } from "@/lib/labels";
import { Icon } from "@/components/core/icons";
import { AppShell } from "../../_AppShell";
import { MarkLearnedButton } from "./MarkLearnedButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mistakes | bando" };

/**
 * `/app/practice/mistakes` — очередь ошибок (P9-rich «вариант B») с SM-2-расписанием
 * (учебная петля, BRIEF §12.3 шаг 2). Server-компонент: auth → getOpenMistakes
 * (owner-path, деривация из review-snapshot + mistake_review). В клиент уходят только
 * безопасные поля (инвариант 2); правильный ответ пользователь смотрит через
 * practice-reveal на самом тесте, не здесь. Две секции: «Due now» (пора повторять) и
 * «Coming up» (запланировано SR). Фильтр по типу вопроса — серверный (?qtype=…),
 * без клиентского стейта. Две кнопки на карточку: «Practise this question» (deep-link
 * P15) и «Mark learned» (owner-path резолюция).
 */
export default async function MistakesPage({
  searchParams,
}: {
  searchParams: Promise<{ qtype?: string }>;
}) {
  const user = await requireUser();
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();
  const sp = await searchParams;
  const mistakes = await getOpenMistakes(user.id, { limit: 50 });

  // Типы для чипов — из ПОЛНОГО набора (до фильтра), в порядке появления; фильтр
  // принимаем только существующим типом (кривой ?qtype игнорируем → «All»).
  const qtypes = [...new Set(mistakes.map((m) => m.qtype))];
  const activeQtype = sp.qtype && qtypes.includes(sp.qtype) ? sp.qtype : null;
  const filtered = activeQtype ? mistakes.filter((m) => m.qtype === activeQtype) : mistakes;
  const due = filtered.filter((m) => m.isDue);
  const scheduled = filtered.filter((m) => !m.isDue);

  return (
    <AppShell active="practice">
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 64px" }}>
        {/* Тап-таргет фильтр-чипов (~29px) < 44px на touch. */}
        <style>{"@media (pointer:coarse){.mistake-chip{min-height:44px}}"}</style>
        <Link href="/app/practice" style={S.back}>
          <Icon name="arrow-left" size={16} strokeWidth={2.4} /> Practice
        </Link>
        <h1 style={S.h1}>Review your mistakes</h1>
        <p style={S.sub}>
          Spaced repetition schedules every mistake. Practise what&apos;s due now; keep getting
          a question right and it graduates out of the queue.
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
          <>
            {qtypes.length > 1 && (
              <div style={S.chips}>
                <FilterChip label="All" href="/app/practice/mistakes" active={activeQtype === null} />
                {qtypes.map((qt) => (
                  <FilterChip
                    key={qt}
                    label={qtypeLabel(qt)}
                    href={`/app/practice/mistakes?qtype=${encodeURIComponent(qt)}`}
                    active={activeQtype === qt}
                  />
                ))}
              </div>
            )}

            {due.length > 0 && (
              <section style={S.section}>
                <h2 style={S.sectionH}>Due now ({due.length})</h2>
                <ul style={S.list}>
                  {due.map((m) => (
                    <MistakeCard key={`${m.contentItemId}:${m.questionNumber}`} m={m} />
                  ))}
                </ul>
              </section>
            )}

            {scheduled.length > 0 && (
              <section style={S.section}>
                <h2 style={S.sectionH}>Coming up ({scheduled.length})</h2>
                <ul style={S.list}>
                  {scheduled.map((m) => (
                    <MistakeCard key={`${m.contentItemId}:${m.questionNumber}`} m={m} />
                  ))}
                </ul>
              </section>
            )}

            {due.length === 0 && scheduled.length === 0 && (
              <div style={S.emptyFilter}>Nothing due for this question type. Try another filter.</div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Серверный фильтр-чип по типу вопроса (Link, без клиентского стейта). */
function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href} className="mistake-chip" style={active ? { ...S.chip, ...S.chipActive } : S.chip}>
      {label}
    </Link>
  );
}

/** «next review in Xd» для запланированной карточки; null — если срок уже прошёл/не задан. */
function nextInLabel(dueAt: Date | null): string | null {
  if (!dueAt) return null;
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days <= 1 ? "next review tomorrow" : `next review in ${days}d`;
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
      {!m.isDue && nextInLabel(m.dueAt) && (
        <div style={S.nextNote}>
          <Icon name="clock" size={13} strokeWidth={2.4} /> {nextInLabel(m.dueAt)}
        </div>
      )}
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
  chips: { display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 20px" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    borderRadius: "var(--radius-full, 999px)",
    border: "1px solid var(--border)",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 700,
    textDecoration: "none",
  },
  chipActive: {
    background: "var(--brand)",
    borderColor: "var(--brand)",
    color: "var(--text-on-brand)",
  },
  section: { marginBottom: 28 },
  sectionH: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 800,
    color: "var(--text-secondary)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    margin: "0 0 12px",
  },
  nextNote: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 700,
    color: "var(--text-muted)",
  },
  emptyFilter: {
    padding: "24px 8px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    color: "var(--text-secondary)",
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
