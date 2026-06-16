"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { categoryLabel } from "@/lib/labels";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { AudioPlayer } from "@/components/exam/AudioPlayer";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { QuestionNavigator } from "@/components/exam/QuestionNavigator";
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
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function ExamRunner({
  attemptId,
  initialAnswers,
  passages,
  questions,
  durationSeconds,
  audioSrc,
  title,
  category,
}: {
  attemptId: string;
  initialAnswers: Record<string, string>;
  passages: Passage[];
  questions: Question[];
  durationSeconds: number | null;
  /** Listening: audio for the whole test. Absent for Reading. */
  audioSrc?: string | null;
  title: string;
  category: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  // Флаги «отметить на потом» — клиентские/эфемерные (review aid, не персистятся).
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [current, setCurrent] = useState(questions[0]?.number ?? 1);
  const [pending, startSubmit] = useTransition();
  const qScrollRef = useRef<HTMLDivElement>(null);

  // Listening: раннер владеет <audio> и часами; AudioPlayer — контролируемый presentational.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioCur, setAudioCur] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Autosave (BRIEF §4.3): debounce-persist answers so a dropped connection or a
  // refresh resumes where the student left off. Fires only when answers actually
  // change (skips the initial render); started_at is server-stamped so the timer
  // keeps running server-side regardless.
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

  // useCallback → стабильные ссылки, чтобы memo(QuestionBlock) реально срабатывал
  // (functional setState, deps пусты).
  const set = useCallback((n: number, v: string) => setAnswers((a) => ({ ...a, [String(n)]: v })), []);
  const flag = useCallback((n: number) => setFlags((f) => ({ ...f, [String(n)]: !f[String(n)] })), []);

  const answered = Object.values(answers).filter((v) => v && v.trim()).length;
  const remaining = durationSeconds != null ? Math.max(0, durationSeconds - elapsed) : null;

  const submit = () => {
    if (pending) return;
    startSubmit(() => submitAttempt(attemptId, answers));
  };

  const jump = (n: number) => {
    setCurrent(n);
    const el = document.getElementById(`q-${n}`);
    const wrap = qScrollRef.current;
    if (el && wrap) wrap.scrollTo({ top: el.offsetTop - 14, behavior: "smooth" });
  };

  const isListening = !!audioSrc;
  const meta = `${categoryLabel(category)} · ${questions.length} questions`;

  const navQuestions = questions.map((q) => ({
    number: q.number,
    answered: !!answers[String(q.number)]?.trim(),
    flagged: !!flags[String(q.number)],
  }));
  const nav = (
    <QuestionNavigator questions={navQuestions} current={current} onJump={jump} columns={10} />
  );
  const answeredCounter = (
    <span style={S.counter}>
      <b style={{ color: "var(--text-secondary)" }}>{answered}</b>/{questions.length} answered
    </span>
  );

  return (
    <div style={S.shell}>
      <style>{READING_CSS}</style>

      {/* Top bar */}
      <div style={S.top}>
        <Link href="/app/reading" aria-label="Exit test" title="Exit test" className="exam-exit" style={S.exit}>
          <Icon name="arrow-left" size={18} strokeWidth={2.4} />
        </Link>
        <div style={{ minWidth: 0 }}>
          <div style={S.topTitle}>{title}</div>
          <div style={S.topMeta}>{meta}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          {durationSeconds != null && remaining != null ? (
            <ExamTimer remainingSeconds={remaining} totalSeconds={durationSeconds} />
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-lg)", fontWeight: 500, color: "var(--text-primary)" }}>
              <Icon name="clock" size={18} style={{ color: "var(--text-muted)" }} /> {fmt(elapsed)}
            </span>
          )}
          <Button trailingIcon="arrow-right" onClick={submit} loading={pending}>
            Submit
          </Button>
        </div>
      </div>

      {isListening ? (
        <>
          {/* Audio banner (BRIEF §4.3) — bando single-pass player: waveform, no
              rewind/seek (waveform not interactive), «Plays once» badge. Раннер
              владеет <audio>, AudioPlayer контролируемый. */}
          <div style={S.audioBar}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {audioSrc && (
                <>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio
                    ref={audioRef}
                    src={audioSrc}
                    preload="metadata"
                    onLoadedMetadata={(e) => setAudioDur(e.currentTarget.duration || 0)}
                    onTimeUpdate={(e) => setAudioCur(e.currentTarget.currentTime)}
                    onPlay={() => setAudioPlaying(true)}
                    onPause={() => setAudioPlaying(false)}
                    onEnded={() => setAudioPlaying(false)}
                    style={{ display: "none" }}
                  />
                  <AudioPlayer
                    progress={audioDur > 0 ? audioCur / audioDur : 0}
                    playing={audioPlaying}
                    totalSeconds={audioDur}
                    onTogglePlay={toggleAudio}
                  />
                </>
              )}
            </div>
          </div>

          <div ref={qScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 24px 48px" }}>
              <div style={S.sheetHead}>
                <span style={S.sheetHint}>Answer as you listen — the recording plays once.</span>
                {answeredCounter}
              </div>
              <div style={{ marginBottom: 16 }}>{nav}</div>
              {questions.map((q) => (
                <QuestionBlock
                  key={q.id}
                  q={q}
                  value={answers[String(q.number)] ?? ""}
                  flagged={!!flags[String(q.number)]}
                  onAnswer={set}
                  onFlag={flag}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* Passage pane */}
          <div style={S.passagePane}>
            <div style={S.passageHead}>
              <Icon name="book-open" size={15} style={{ color: "var(--reading-muted)" }} />
              <span style={S.passageHeadText}>Reading passage</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <article className="bando-reading" style={{ padding: "26px 32px 40px", maxWidth: "62ch", margin: "0 auto" }}>
                {passages.map((p, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: p.body_html }} />
                ))}
              </article>
            </div>
          </div>

          {/* Questions + navigator pane */}
          <div style={S.qPane}>
            <div style={S.navHead}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 11 }}>
                <span style={S.navTitle}>Question navigator</span>
                {answeredCounter}
              </div>
              {nav}
            </div>
            <div ref={qScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 20px 28px" }}>
              {questions.map((q) => (
                <QuestionBlock
                  key={q.id}
                  q={q}
                  value={answers[String(q.number)] ?? ""}
                  flagged={!!flags[String(q.number)]}
                  onAnswer={set}
                  onFlag={flag}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const QuestionBlock = memo(function QuestionBlock({
  q,
  value,
  flagged,
  onAnswer,
  onFlag,
}: {
  q: Question;
  value: string;
  flagged: boolean;
  onAnswer: (n: number, v: string) => void;
  onFlag: (n: number) => void;
}) {
  return (
    <div id={`q-${q.number}`} style={{ marginBottom: 12 }}>
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <span style={{ ...S.qNum, background: value ? "var(--brand)" : "var(--surface-hover)", color: value ? "var(--text-on-brand)" : "var(--text-secondary)" }}>{q.number}</span>
          <div style={S.qPrompt}>{q.prompt_html}</div>
          <button
            onClick={() => onFlag(q.number)}
            aria-pressed={flagged}
            aria-label="Flag for review"
            title="Mark for review"
            style={{ flex: "none", border: "none", background: flagged ? "var(--warn-subtle)" : "transparent", borderRadius: 9, padding: 6, cursor: "pointer", color: flagged ? "var(--warn)" : "var(--text-disabled)", transition: "var(--transition-colors)" }}
          >
            <Icon name="flag" size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div style={{ marginTop: 13, paddingLeft: 39 }}>
          {q.options && q.options.length > 0 ? (
            <div role="radiogroup" aria-label={`Answer for question ${q.number}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {q.options.map((o) => {
                const sel = value === o.value;
                return (
                  <button
                    key={o.value}
                    role="radio"
                    aria-checked={sel}
                    onClick={() => onAnswer(q.number, o.value)}
                    style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", padding: "11px 14px", borderRadius: "var(--radius-md)", border: `2px solid ${sel ? "var(--brand)" : "var(--border)"}`, background: sel ? "var(--brand-subtle)" : "var(--surface-raised)", color: sel ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", transition: "var(--transition-colors)" }}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: "50%", flex: "none", border: `2px solid ${sel ? "var(--brand)" : "var(--border-strong)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {sel && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)" }} />}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              value={value}
              onChange={(e) => onAnswer(q.number, e.target.value)}
              placeholder="Type your answer"
              aria-label={`Answer for question ${q.number}`}
              autoComplete="off"
              style={{ width: "100%", maxWidth: 300, height: 44, padding: "0 15px", borderRadius: "var(--radius-md)", border: `2px solid ${value ? "var(--brand)" : "var(--border)"}`, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", outline: "none" }}
            />
          )}
        </div>
      </div>
    </div>
  );
});

const READING_CSS = `
.bando-reading{font-family:var(--font-reading);color:var(--reading-text);font-size:var(--text-base);line-height:var(--leading-relaxed)}
.bando-reading p{margin:0 0 1em}
.bando-reading h1,.bando-reading h2,.bando-reading h3{font-family:var(--font-reading);color:var(--reading-text);line-height:1.25}
.bando-reading mark{background:var(--reading-mark);border-radius:3px;padding:0 .08em}
.exam-exit{background:transparent;transition:var(--transition-colors)}
.exam-exit:hover{background:var(--surface-hover)}
@keyframes nine-blink{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){[style*="nine-blink"]{animation:none!important}}
`;

const S: Record<string, React.CSSProperties> = {
  shell: { height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)" },

  top: { display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", flex: "none" },
  exit: { flex: "none", width: 38, height: 38, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", color: "var(--text-secondary)", textDecoration: "none" },
  topTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  topMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  audioBar: { padding: "16px 24px", background: "var(--bg-raised)", borderBottom: "1px solid var(--border)", flex: "none" },

  sheetHead: { display: "flex", alignItems: "center", marginBottom: 14 },
  sheetHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  counter: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  passagePane: { flex: "1.15", minWidth: 0, display: "flex", flexDirection: "column", background: "var(--reading-surface)", borderRight: "1px solid var(--border)" },
  passageHead: { display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderBottom: "1px solid var(--reading-rule)", flex: "none" },
  passageHeadText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--reading-muted)" },

  qPane: { width: 460, flex: "none", display: "flex", flexDirection: "column", background: "var(--bg-base)" },
  navHead: { padding: "14px 20px", borderBottom: "1px solid var(--border)", flex: "none" },
  navTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap" },

  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", boxShadow: "var(--shadow-solid)" },
  qNum: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)", width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 },
  qPrompt: { flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", lineHeight: 1.5, paddingTop: 3 },
};
