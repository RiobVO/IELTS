"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { qtypeLabel } from "@/lib/labels";
import { saveProgress, submitAttempt } from "./actions";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
}
interface Passage {
  title: string | null;
  body_html: string;
  order: number;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ExamRunner({
  attemptId,
  initialAnswers,
  passages,
  questions,
  durationSeconds,
  audioSrc,
}: {
  attemptId: string;
  initialAnswers: Record<string, string>;
  passages: Passage[];
  questions: Question[];
  durationSeconds: number | null;
  /** Listening: audio for the whole test. Absent for Reading. */
  audioSrc?: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [elapsed, setElapsed] = useState(0);
  const [pending, startSubmit] = useTransition();

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Autosave (BRIEF §4.3): debounce-persist answers so a dropped connection or a
  // refresh resumes where the student left off. Fires only when answers actually
  // change (skips the initial render), and the server stamp of started_at means
  // the timer keeps running server-side regardless.
  const saved = useRef(JSON.stringify(initialAnswers));
  useEffect(() => {
    const snapshot = JSON.stringify(answers);
    if (snapshot === saved.current) return;
    const t = setTimeout(() => {
      saved.current = snapshot;
      void saveProgress(attemptId, answers);
    }, 1500);
    return () => clearTimeout(t);
  }, [answers, attemptId]);

  const set = (n: number, v: string) =>
    setAnswers((a) => ({ ...a, [String(n)]: v }));

  const answered = Object.values(answers).filter((v) => v && v.trim()).length;
  const remaining =
    durationSeconds != null ? Math.max(0, durationSeconds - elapsed) : null;

  const submit = () => {
    if (pending) return;
    startSubmit(() => submitAttempt(attemptId, answers));
  };

  return (
    <div style={S.shell}>
      {audioSrc && (
        // Listening audio (BRIEF §4.3). Sticky at the top so it stays reachable
        // while scrolling the parts. MVP uses native controls; the strict
        // single-pass rule (no rewind) is a later refinement.
        <div style={S.audioBar}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioSrc} style={{ width: "100%" }} />
        </div>
      )}
      <div style={S.cols}>
        <section style={S.passageCol}>
          {passages.map((p, i) => (
            <article
              key={i}
              style={S.passage}
              dangerouslySetInnerHTML={{ __html: p.body_html }}
            />
          ))}
        </section>

        <section style={S.qCol}>
          <h2 style={S.qHeading}>Questions 1–{questions.length}</h2>
          {questions.map((q) => {
            const val = answers[String(q.number)] ?? "";
            return (
              <div key={q.id} style={S.q} id={`q-${q.number}`}>
                <div style={S.qHead}>
                  <span style={S.qNum}>{q.number}</span>
                  <span style={S.qType}>{qtypeLabel(q.qtype)}</span>
                </div>
                <div style={S.qPrompt}>{q.prompt_html}</div>
                {q.options && q.options.length > 0 ? (
                  <div style={S.opts}>
                    {q.options.map((o) => (
                      <label
                        key={o.value}
                        style={{
                          ...S.opt,
                          ...(val === o.value ? S.optActive : {}),
                        }}
                      >
                        <input
                          type="radio"
                          name={`q${q.number}`}
                          checked={val === o.value}
                          onChange={() => set(q.number, o.value)}
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    style={S.input}
                    value={val}
                    onChange={(e) => set(q.number, e.target.value)}
                    placeholder="your answer"
                    autoComplete="off"
                  />
                )}
              </div>
            );
          })}
        </section>
      </div>

      <footer style={S.footer}>
        <div style={S.timer}>
          ⏱ {fmt(elapsed)}
          {remaining != null && (
            <span style={S.remaining}> · осталось {fmt(remaining)}</span>
          )}
        </div>
        <div style={S.progress}>
          {answered}/{questions.length} отвечено
        </div>
        <button onClick={submit} disabled={pending} style={S.submit}>
          {pending ? "Проверяю…" : "Сдать тест"}
        </button>
      </footer>
    </div>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const READING_FONT = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

const S: Record<string, React.CSSProperties> = {
  shell: { paddingBottom: 80 },
  audioBar: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    maxWidth: 1100,
    margin: "0 auto",
    padding: ".6rem 0",
    background: "#fff",
  },
  cols: {
    maxWidth: 1100,
    margin: "1rem auto 0",
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "1.25rem",
  },
  passageCol: {},
  passage: {
    fontFamily: READING_FONT,
    fontSize: "1.02rem",
    lineHeight: 1.7,
    color: "#1c1c22",
  },
  qCol: { borderTop: "1px solid #eee", paddingTop: "1rem" },
  qHeading: { fontSize: "1.1rem", margin: "0 0 1rem", fontFamily: FONT },
  q: {
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    marginBottom: ".7rem",
    fontFamily: FONT,
  },
  qHead: {
    display: "flex",
    alignItems: "center",
    gap: ".5rem",
    marginBottom: ".4rem",
  },
  qNum: {
    background: "#111827",
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
  qType: { color: "#999", fontSize: ".72rem" },
  qPrompt: { fontSize: ".95rem", lineHeight: 1.5, marginBottom: ".5rem" },
  opts: { display: "flex", flexDirection: "column", gap: ".3rem" },
  opt: {
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    fontSize: ".9rem",
    color: "#444",
    padding: ".35rem .5rem",
    borderRadius: 7,
    border: "1px solid transparent",
    cursor: "pointer",
  },
  optActive: { background: "#f1eefe", borderColor: "#d9d2fb", color: "#4a3bd0" },
  input: {
    padding: ".5rem .7rem",
    border: "1px solid #ccc",
    borderRadius: 7,
    fontSize: ".95rem",
    width: "100%",
    maxWidth: 280,
  },
  footer: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    background: "#fff",
    borderTop: "1px solid #e7e7ee",
    boxShadow: "0 -2px 10px rgba(0,0,0,.04)",
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: ".7rem 1.25rem",
    fontFamily: FONT,
  },
  timer: { fontWeight: 700, fontSize: ".95rem" },
  remaining: { color: "#999", fontWeight: 500 },
  progress: { color: "#777", fontSize: ".85rem" },
  submit: {
    marginLeft: "auto",
    background: "#6C5CE7",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: ".65rem 1.4rem",
    fontWeight: 700,
    fontSize: ".95rem",
    cursor: "pointer",
  },
};
