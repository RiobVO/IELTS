import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, question } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { qtypeLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/auth");
  const { id } = await params;
  const { a: attemptId } = await searchParams;
  if (!attemptId) notFound();

  const [att] = await db.select().from(attempt).where(eq(attempt.id, attemptId));
  // Ownership check — a user can only see their own attempt's review.
  if (!att || att.userId !== user.id || att.contentItemId !== id) notFound();

  // answer_key read server-side (owner role) — explanations/evidence revealed
  // only AFTER submit (BRIEF §4.2), and only to the attempt's owner.
  const rows = await db
    .select({
      number: question.number,
      qtype: question.qtype,
      promptHtml: question.promptHtml,
      mode: answerKey.mode,
      accept: answerKey.accept,
      explanation: answerKey.explanation,
      evidence: answerKey.evidence,
    })
    .from(question)
    .innerJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(eq(question.contentItemId, id))
    .orderBy(question.number);

  const answers = (att.answers ?? {}) as Record<string, string | string[]>;
  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));
  const result = grade(keys, answers);
  const meta = new Map(rows.map((r) => [r.number, r]));

  const perType = Object.entries(result.perType).sort(
    (a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total,
  );

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app/reading" style={S.back}>
          ← Каталог
        </Link>

        <div style={S.scoreCard}>
          <div style={S.score}>
            {result.rawScore}
            <span style={S.scoreTotal}>/{result.total}</span>
          </div>
          <div style={S.percent}>{result.percent}% правильных</div>
          <div style={S.note}>
            Band показываем только для Full-тестов (40 вопросов) — здесь одиночный
            passage, поэтому процент.
          </div>
        </div>

        <h2 style={S.h2}>Разбивка по типам вопросов</h2>
        <p style={S.sub}>Где ты теряешь баллы — слабые типы вверху.</p>
        <div style={S.types}>
          {perType.map(([type, s]) => {
            const pct = Math.round((s.correct / s.total) * 100);
            return (
              <div key={type} style={S.typeRow}>
                <div style={S.typeName}>{qtypeLabel(type)}</div>
                <div style={S.barTrack}>
                  <div
                    style={{
                      ...S.barFill,
                      width: `${pct}%`,
                      background: pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
                <div style={S.typeScore}>
                  {s.correct}/{s.total}
                </div>
              </div>
            );
          })}
        </div>

        <h2 style={S.h2}>Разбор по вопросам</h2>
        <div style={S.review}>
          {result.perQuestion.map((q) => {
            const m = meta.get(q.number)!;
            const given = Array.isArray(q.given) ? q.given.join(", ") : q.given;
            const correctAns = (m.accept as string[]).join(" / ");
            const ev = m.evidence as { para: string; snippet: string } | null;
            return (
              <div key={q.number} style={S.rev}>
                <div style={S.revHead}>
                  <span style={{ ...S.revNum, background: q.correct ? "#10b981" : "#ef4444" }}>
                    {q.number}
                  </span>
                  <span style={S.revType}>{qtypeLabel(q.qtype)}</span>
                  <span style={{ ...S.revMark, color: q.correct ? "#10b981" : "#ef4444" }}>
                    {q.correct ? "✓ верно" : "✗ неверно"}
                  </span>
                </div>
                <div style={S.revLine}>
                  <span style={S.revLabel}>Твой ответ:</span>{" "}
                  <span style={{ color: q.correct ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {given && given !== "" ? given : "—"}
                  </span>
                </div>
                {!q.correct && (
                  <div style={S.revLine}>
                    <span style={S.revLabel}>Правильно:</span>{" "}
                    <strong>{correctAns}</strong>
                  </div>
                )}
                {m.explanation && <div style={S.expl}>{m.explanation}</div>}
                {ev?.snippet && (
                  <div style={S.evidence}>
                    <span style={S.evLabel}>Из текста:</span> «{ev.snippet}»
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Link href={`/app/reading/${id}`} style={S.retry}>
          Пройти заново
        </Link>
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "1.5rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 780, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  scoreCard: {
    marginTop: "1rem",
    textAlign: "center",
    background: "#0f172a",
    color: "#fff",
    borderRadius: 16,
    padding: "2rem 1rem",
  },
  score: { fontSize: "3.4rem", fontWeight: 800, lineHeight: 1 },
  scoreTotal: { fontSize: "1.6rem", color: "#94a3b8", fontWeight: 700 },
  percent: { marginTop: ".4rem", color: "#cbd5e1", fontWeight: 600 },
  note: { marginTop: ".75rem", color: "#64748b", fontSize: ".78rem", maxWidth: 420, marginInline: "auto" },
  h2: { fontSize: "1.2rem", margin: "1.75rem 0 .25rem" },
  sub: { color: "#777", margin: "0 0 .9rem", fontSize: ".9rem" },
  types: { display: "grid", gap: ".55rem" },
  typeRow: { display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: ".7rem", alignItems: "center" },
  typeName: { fontSize: ".85rem", fontWeight: 600 },
  barTrack: { background: "#eef0f3", borderRadius: 999, height: 10, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  typeScore: { fontSize: ".82rem", color: "#555", fontWeight: 700, minWidth: 34, textAlign: "right" },
  review: { display: "grid", gap: ".7rem" },
  rev: { border: "1px solid #ececf1", borderRadius: 10, padding: ".8rem .9rem" },
  revHead: { display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".5rem" },
  revNum: {
    color: "#fff",
    fontWeight: 800,
    fontSize: ".75rem",
    width: 22,
    height: 22,
    borderRadius: 5,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  revType: { color: "#999", fontSize: ".72rem" },
  revMark: { marginLeft: "auto", fontSize: ".8rem", fontWeight: 700 },
  revLine: { fontSize: ".9rem", marginBottom: ".2rem" },
  revLabel: { color: "#888" },
  expl: { marginTop: ".5rem", fontSize: ".88rem", color: "#374151", lineHeight: 1.5 },
  evidence: {
    marginTop: ".4rem",
    fontSize: ".82rem",
    color: "#137a3a",
    background: "#eafaef",
    padding: ".45rem .6rem",
    borderRadius: 7,
  },
  evLabel: { fontWeight: 700 },
  retry: {
    display: "inline-block",
    marginTop: "1.5rem",
    padding: ".65rem 1.2rem",
    border: "1px solid #ddd",
    borderRadius: 10,
    color: "#333",
    fontWeight: 600,
  },
};
