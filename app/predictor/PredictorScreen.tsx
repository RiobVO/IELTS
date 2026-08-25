"use client";

/**
 * Экран публичной пробы (G1-6). Три состояния: интро → вопросы → результат.
 *
 * Результат разный по гостю/юзеру ОСОЗНАННО: гость видит диапазон band и то, что
 * слабый тип найден; название типа и разбор по типам — после регистрации. Это и
 * есть обмен, ради которого страница существует; врать («band 7.0!») или отдавать
 * всё бесплатно одинаково бессмысленно.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { Logo } from "@/components/core/Logo";
import { qtypeLabel } from "@/lib/labels";
import { formatBandRange } from "@/lib/predictor/grade";
import type { PublicQuestion } from "@/lib/predictor/bank";
import type { PredictorSnapshot } from "@/lib/predictor/snapshot";
import { submitPredictor } from "./actions";

type Stage = "intro" | "test" | "result";

export default function PredictorScreen({
  questions,
  passages,
  initialSnapshot,
  authed,
}: {
  questions: PublicQuestion[];
  passages: Record<1 | 2, { title: string; body: string }>;
  initialSnapshot: PredictorSnapshot | null;
  authed: boolean;
}) {
  const [stage, setStage] = useState<Stage>(initialSnapshot ? "result" : "intro");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [snapshot, setSnapshot] = useState<PredictorSnapshot | null>(initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const answered = useMemo(
    () => questions.filter((q) => (answers[String(q.number)] ?? "").trim() !== "").length,
    [answers, questions],
  );

  const setAnswer = (n: number, v: string) => setAnswers((a) => ({ ...a, [String(n)]: v }));

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await submitPredictor(answers);
    setPending(false);
    if (!res.ok) {
      setError(
        res.reason === "throttled"
          ? "Too many attempts from your network right now. Try again in a few minutes."
          : "Something went wrong scoring that. Try again in a moment.",
      );
      return;
    }
    setSnapshot(res.snapshot);
    setStage("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div style={S.screen}>
      <header style={S.head}>
        <a href="/" aria-label="bando home" style={{ display: "inline-flex", textDecoration: "none" }}>
          <Logo size={26} />
        </a>
        <a href="/auth?src=predictor" style={S.headCta}>
          {authed ? "Go to app →" : "Create a free account →"}
        </a>
      </header>

      <main style={S.main}>
        {stage === "intro" && <Intro onStart={() => setStage("test")} count={questions.length} />}

        {stage === "test" && (
          <>
            {([1, 2] as const).map((p) => (
              <section key={p} style={S.block}>
                <h2 style={S.passageTitle}>{passages[p].title}</h2>
                <div style={S.passage}>
                  {passages[p].body.split("\n\n").map((para, i) => (
                    <p key={i} style={S.para}>{para}</p>
                  ))}
                </div>
                <div style={S.qList}>
                  {questions
                    .filter((q) => q.passage === p)
                    .map((q) => (
                      <QuestionBlock
                        key={q.number}
                        q={q}
                        value={answers[String(q.number)] ?? ""}
                        onChange={(v) => setAnswer(q.number, v)}
                      />
                    ))}
                </div>
              </section>
            ))}

            {error && <div style={S.error}>{error}</div>}

            <div style={S.submitRow}>
              <span style={S.progressText}>
                {answered} of {questions.length} answered
              </span>
              <Button size="lg" onClick={submit} disabled={pending} trailingIcon="arrow-right">
                {pending ? "Scoring…" : "See my band range"}
              </Button>
            </div>
          </>
        )}

        {stage === "result" && snapshot && <Result snapshot={snapshot} authed={authed} />}
      </main>
    </div>
  );
}

function Intro({ onStart, count }: { onStart: () => void; count: number }) {
  return (
    <section style={{ textAlign: "center" }}>
      <div style={S.eyebrow}>Free band predictor</div>
      <h1 style={S.h1}>Where would you land today?</h1>
      <p style={S.lead}>
        {count} IELTS-format Reading questions over two short passages, about ten minutes. You get an
        indicative band range — and the question type quietly costing you the most marks.
      </p>
      <Button size="lg" onClick={onStart} trailingIcon="arrow-right">
        Start the check
      </Button>
      <p style={S.note}>No sign-up to start. No card, ever, for Reading and Listening.</p>
    </section>
  );
}

function QuestionBlock({
  q,
  value,
  onChange,
}: {
  q: PublicQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={S.q}>
      <div style={S.qPrompt}>
        <span style={S.qNum}>Q{q.number}</span> {q.prompt}
      </div>
      {q.options ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {q.options.map((opt) => {
            const on = value === opt;
            return (
              <button
                key={opt}
                type="button"
                className="pr-opt"
                onClick={() => onChange(opt)}
                aria-pressed={on}
                style={{ ...S.opt, ...(on ? S.optOn : null) }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer"
          aria-label={`Answer for question ${q.number}`}
        />
      )}
    </div>
  );
}

function Result({ snapshot, authed }: { snapshot: PredictorSnapshot; authed: boolean }) {
  const range = formatBandRange(snapshot.l, snapshot.h);
  return (
    <section style={{ textAlign: "center" }}>
      <div style={S.eyebrow}>Your indicative range</div>
      <div style={S.band}>{range}</div>
      <div style={S.bandCaption}>
        {snapshot.c} of {snapshot.t} correct
      </div>
      <p style={S.disclaimer}>
        Ten questions can only indicate a range. A full 40-question mock on the official band scale
        gives you the real number — that&apos;s free too.
      </p>

      {authed ? (
        <div style={S.unlocked}>
          {snapshot.w ? (
            <>
              <div style={S.unlockedKey}>Your weakest question type</div>
              <div style={S.unlockedVal}>{qtypeLabel(snapshot.w)}</div>
              <p style={S.unlockedText}>
                Drill this one first — it has the biggest effect on your band. Your practice hub is
                already filtered for it.
              </p>
              <Button size="lg" href={`/app/practice?q_type=${encodeURIComponent(snapshot.w)}`} trailingIcon="arrow-right">
                Drill {qtypeLabel(snapshot.w)}
              </Button>
            </>
          ) : (
            <>
              <div style={S.unlockedVal}>Every type clean.</div>
              <p style={S.unlockedText}>
                Nothing to single out from ten questions — sit a full mock and get a real band.
              </p>
              <Button size="lg" href="/app/practice" trailingIcon="arrow-right">
                Take a full mock
              </Button>
            </>
          )}
        </div>
      ) : (
        <div style={S.locked}>
          <div style={S.lockedKey}>
            {snapshot.w ? "We found the type costing you marks" : "You answered every type correctly"}
          </div>
          <p style={S.lockedText}>
            {snapshot.w
              ? "Create a free account to see which type it is, get the full breakdown, and drill it straight away."
              : "Create a free account to sit a full 40-question mock and get a real band on the official scale."}
          </p>
          <Button size="lg" href="/auth?src=predictor&next=/predictor" trailingIcon="arrow-right">
            Unlock my breakdown
          </Button>
          <p style={S.note}>Free account. No card. Takes about twenty seconds.</p>
        </div>
      )}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  screen: { minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "var(--font-ui)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)" },
  headCta: { fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)", textDecoration: "none" },
  main: { width: "100%", maxWidth: 720, margin: "0 auto", padding: "34px 20px 64px", display: "flex", flexDirection: "column", gap: 28 },
  eyebrow: { fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--brand)" },
  h1: { fontSize: "var(--text-3xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "10px 0 12px" },
  lead: { fontSize: "var(--text-base)", color: "var(--text-muted)", lineHeight: 1.55, margin: "0 auto 26px", maxWidth: 480 },
  note: { fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 14 },
  block: { display: "flex", flexDirection: "column", gap: 16 },
  passageTitle: { fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)" },
  passage: { background: "var(--reading-surface)", border: "1px solid var(--reading-rule)", borderRadius: "var(--radius-lg)", padding: "18px 20px" },
  para: { fontFamily: "var(--font-reading)", fontSize: "var(--text-base)", lineHeight: "var(--leading-relaxed)", color: "var(--reading-text)", marginBottom: 12 },
  qList: { display: "flex", flexDirection: "column", gap: 20 },
  q: { display: "flex", flexDirection: "column", gap: 10 },
  qPrompt: { fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 },
  qNum: { fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginRight: 4 },
  opt: { minHeight: 44, padding: "8px 14px", border: "2px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", transition: "var(--transition-colors)" },
  optOn: { borderColor: "var(--brand)", background: "var(--brand-subtle)", color: "var(--text-link)" },
  submitRow: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, paddingTop: 8 },
  progressText: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  error: { fontSize: "var(--text-sm)", color: "var(--error-text)", background: "var(--error-subtle)", border: "1px solid var(--error)", borderRadius: "var(--radius-md)", padding: "10px 14px" },
  band: { fontFamily: "var(--font-mono)", fontSize: 62, fontWeight: 800, lineHeight: 1.05, color: "var(--brand)", marginTop: 8 },
  bandCaption: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 4 },
  disclaimer: { fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.55, margin: "16px auto 0", maxWidth: 460 },
  locked: { marginTop: 28, padding: "26px 22px", borderRadius: "var(--radius-xl)", border: "2px solid var(--brand-border)", background: "linear-gradient(180deg, var(--brand-subtle), var(--surface))" },
  lockedKey: { fontSize: "var(--text-lg)", fontWeight: 800, marginBottom: 8 },
  lockedText: { fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 auto 18px", maxWidth: 420 },
  unlocked: { marginTop: 28, padding: "26px 22px", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)", background: "var(--surface-raised)" },
  unlockedKey: { fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" },
  unlockedVal: { fontSize: "var(--text-xl)", fontWeight: 800, marginTop: 4 },
  unlockedText: { fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, margin: "10px auto 18px", maxWidth: 420 },
};
