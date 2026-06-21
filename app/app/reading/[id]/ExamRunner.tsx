"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { categoryLabel } from "@/lib/labels";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { AudioPlayer } from "@/components/exam/AudioPlayer";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { QuestionNavigator, type NavPart } from "@/components/exam/QuestionNavigator";
import { PassagePane, type AnnotationRow } from "./PassagePane";
import { saveProgress, submitAttempt } from "./actions";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
  passage_id: string | null;
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

/** Вопрос отвечен: непустая строка ИЛИ непустой набор букв (mcq_multi). */
function isAnswered(v: string | string[] | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : !!(v && v.trim());
}

/** Группировка вопросов по passage_id → «Part N» в нижнем навигаторе (порядок появления).
 *  passage_id может отсутствовать (одиночный пассаж / старые данные) → один блок. */
function buildParts(
  questions: Question[],
  answers: Record<string, string | string[]>,
  flags: Record<string, boolean>,
): NavPart[] {
  const order: string[] = [];
  const groups = new Map<string, NavPart["items"]>();
  for (const q of questions) {
    const key = q.passage_id ?? "_single";
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push({
      number: q.number,
      answered: isAnswered(answers[String(q.number)]),
      flagged: !!flags[String(q.number)],
    });
  }
  return order.map((key, i) => ({ label: `Part ${i + 1}`, items: groups.get(key)! }));
}

export default function ExamRunner({
  attemptId,
  contentItemId,
  initialAnswers,
  passages,
  questions,
  durationSeconds,
  audioSrc,
  title,
  category,
  initialAnnotations,
}: {
  attemptId: string;
  contentItemId: string;
  initialAnswers: Record<string, string | string[]>;
  passages: Passage[];
  questions: Question[];
  durationSeconds: number | null;
  /** Listening: audio for the whole test. Absent for Reading. */
  audioSrc?: string | null;
  title: string;
  category: string;
  /** Reader highlights/notes for this test (W2-1) — reading mode only. */
  initialAnnotations?: AnnotationRow[];
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initialAnswers);
  // Флаги «отметить на потом» — клиентские/эфемерные (review aid, не персистятся).
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [current, setCurrent] = useState(questions[0]?.number ?? 1);
  // Reading на мобильном: две панели → один full-width таб (Passage/Questions).
  // Десктоп игнорирует это (обе панели видны, см. .exam-split CSS).
  const [pane, setPane] = useState<"passage" | "questions">("passage");
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
  // mcq_multi: переключаем букву в наборе ответа (string[]). Порядок грейдеру не важен
  // (mcq_set сверяет множества), сортируем лишь для стабильного отображения.
  const toggle = useCallback(
    (n: number, letter: string) =>
      setAnswers((a) => {
        const cur = a[String(n)];
        const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
        const next = arr.includes(letter)
          ? arr.filter((x) => x !== letter)
          : [...arr, letter].sort();
        return { ...a, [String(n)]: next };
      }),
    [],
  );
  const flag = useCallback((n: number) => setFlags((f) => ({ ...f, [String(n)]: !f[String(n)] })), []);

  const answered = Object.values(answers).filter(isAnswered).length;
  const remaining = durationSeconds != null ? Math.max(0, durationSeconds - elapsed) : null;

  const submit = () => {
    if (pending) return;
    startSubmit(() => submitAttempt(attemptId, answers));
  };

  const jump = (n: number) => {
    setCurrent(n);
    setPane("questions"); // на мобильном гарантируем, что таб вопросов активен
    const el = document.getElementById(`q-${n}`);
    const wrap = qScrollRef.current;
    if (el && wrap) wrap.scrollTo({ top: el.offsetTop - 14, behavior: "smooth" });
  };

  const isListening = !!audioSrc;
  const meta = `${categoryLabel(category)} · ${questions.length} questions`;

  const partGroups = buildParts(questions, answers, flags);

  return (
    <div style={S.shell}>
      <style>{READING_CSS}</style>

      {/* Top bar */}
      <div className="exam-top" style={S.top}>
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
              </div>
              {questions.map((q) => (
                <QuestionBlock
                  key={q.id}
                  q={q}
                  value={answers[String(q.number)] ?? ""}
                  flagged={!!flags[String(q.number)]}
                  onAnswer={set}
                  onToggle={toggle}
                  onFlag={flag}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Mobile-only сегмент-переключатель панелей (скрыт ≥1024px). */}
          <div className="exam-tabs" role="tablist" aria-label="Exam view" style={S.tabs}>
            <button role="tab" aria-selected={pane === "passage"} onClick={() => setPane("passage")} style={tabBtn(pane === "passage")}>
              <Icon name="book-open" size={16} strokeWidth={2.4} /> Passage
            </button>
            <button role="tab" aria-selected={pane === "questions"} onClick={() => setPane("questions")} style={tabBtn(pane === "questions")}>
              Questions
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, opacity: 0.85 }}>{answered}/{questions.length}</span>
            </button>
          </div>

          <div className="exam-split" data-pane={pane} style={{ flex: 1, minHeight: 0, width: "100%", maxWidth: 1400, margin: "0 auto" }}>
            {/* Passage pane — editorial layout + reader annotations (S6 / W2-1) */}
            <PassagePane
              className="exam-pane exam-pane-p"
              contentItemId={contentItemId}
              title={title}
              category={category}
              passages={passages}
              initialAnnotations={initialAnnotations ?? []}
            />

            {/* Questions pane (навигатор вынесен в нижнюю полосу) */}
            <div className="exam-pane exam-pane-q" style={S.qPane}>
              <div ref={qScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px 28px" }}>
              {questions.map((q) => (
                <QuestionBlock
                  key={q.id}
                  q={q}
                  value={answers[String(q.number)] ?? ""}
                  flagged={!!flags[String(q.number)]}
                  onAnswer={set}
                  onToggle={toggle}
                  onFlag={flag}
                />
              ))}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Нижний навигатор 1–40 на всю ширину (как в реальном computer-IELTS):
          группы по Part, review-флаги, click-to-jump. Общий для Reading и Listening. */}
      <QuestionNavigator
        parts={partGroups}
        current={current}
        answered={answered}
        total={questions.length}
        onJump={jump}
      />
    </div>
  );
}

// Общий стиль кнопки-варианта (radio/checkbox) — один источник, чтобы две ветки
// не расходились визуально.
const optBtn = (sel: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 11,
  textAlign: "left",
  padding: "13px 14px",
  minHeight: 46, // touch-комфортная цель
  borderRadius: "var(--radius-md)",
  border: `2px solid ${sel ? "var(--brand)" : "var(--border)"}`,
  background: sel ? "var(--brand-subtle)" : "var(--surface-raised)",
  color: sel ? "var(--text-primary)" : "var(--text-secondary)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
  transition: "var(--transition-colors)",
});

// Сегмент-кнопка мобильного переключателя панелей (Passage / Questions).
const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: 42,
  borderRadius: "var(--radius-md)",
  border: "none",
  background: active ? "var(--brand)" : "var(--surface-inset)",
  color: active ? "var(--text-on-brand)" : "var(--text-secondary)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 700,
  cursor: "pointer",
  transition: "var(--transition-colors)",
});

const QuestionBlock = memo(function QuestionBlock({
  q,
  value,
  flagged,
  onAnswer,
  onToggle,
  onFlag,
}: {
  q: Question;
  value: string | string[];
  flagged: boolean;
  onAnswer: (n: number, v: string) => void;
  onToggle: (n: number, letter: string) => void;
  onFlag: (n: number) => void;
}) {
  const hasOptions = !!q.options && q.options.length > 0;
  // mcq_multi оценивается как набор букв (mcq_set) → нужен мультивыбор; остальные
  // option-вопросы — одиночный radio. Нормализуем value к набору/строке.
  const multi = hasOptions && q.qtype === "mcq_multi";
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const single = Array.isArray(value) ? (value[0] ?? "") : value;
  const has = selected.length > 0;

  // Roving tabindex для radiogroup (ARIA APG radio): группа — единственный tab-stop,
  // стрелки двигают фокус И выбор по кругу. Рефы — чтобы фокусировать соседа программно.
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const radioTabStop = hasOptions ? Math.max(0, q.options!.findIndex((o) => single === o.value)) : 0;
  const onRadioKey = (e: React.KeyboardEvent, idx: number) => {
    const opts = q.options;
    if (!opts) return;
    let next = idx;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (idx + 1) % opts.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (idx - 1 + opts.length) % opts.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = opts.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onAnswer(q.number, opts[next].value);
    radioRefs.current[next]?.focus();
  };

  return (
    <div id={`q-${q.number}`} style={{ marginBottom: 12 }}>
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <span style={{ ...S.qNum, background: has ? "var(--brand)" : "var(--surface-hover)", color: has ? "var(--text-on-brand)" : "var(--text-secondary)" }}>{q.number}</span>
          <div style={S.qPrompt}>{q.prompt_html}</div>
          <button
            className="exam-flag"
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
          {multi ? (
            <div role="group" aria-label={`Answer for question ${q.number} — choose one or more`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {q.options!.map((o) => {
                const sel = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    role="checkbox"
                    aria-checked={sel}
                    onClick={() => onToggle(q.number, o.value)}
                    style={optBtn(sel)}
                  >
                    <span style={{ width: 18, height: 18, borderRadius: 5, flex: "none", border: `2px solid ${sel ? "var(--brand)" : "var(--border-strong)"}`, background: sel ? "var(--brand)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {sel && <Icon name="check" size={12} style={{ color: "var(--text-on-brand)" }} />}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : hasOptions ? (
            <div role="radiogroup" aria-label={`Answer for question ${q.number}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {q.options!.map((o, i) => {
                const sel = single === o.value;
                return (
                  <button
                    key={o.value}
                    ref={(el) => {
                      radioRefs.current[i] = el;
                    }}
                    role="radio"
                    aria-checked={sel}
                    tabIndex={i === radioTabStop ? 0 : -1}
                    onClick={() => onAnswer(q.number, o.value)}
                    onKeyDown={(e) => onRadioKey(e, i)}
                    style={optBtn(sel)}
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
              value={single}
              onChange={(e) => onAnswer(q.number, e.target.value)}
              placeholder="Type your answer"
              aria-label={`Answer for question ${q.number}`}
              autoComplete="off"
              style={{ width: "100%", maxWidth: 300, height: 44, padding: "0 15px", borderRadius: "var(--radius-md)", border: `2px solid ${single ? "var(--brand)" : "var(--border)"}`, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", outline: "none" }}
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
/* Touch target: кнопка-флаг ≥44px на грубом указателе (мышь/десктоп без изменений). */
.exam-flag{display:inline-flex;align-items:center;justify-content:center}
@media (pointer:coarse){.exam-flag{min-width:44px;min-height:44px}}
@keyframes nine-blink{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){[style*="nine-blink"]{animation:none!important}}

/* --- Адаптив reading-раннера. База = мобильный: один full-width таб; ≥1024px =
   две панели бок-о-бок (десктоп без изменений). display/flex/width переключаемых
   узлов заданы ТОЛЬКО здесь, не inline — иначе media-query не победит. --- */
.exam-top{padding:10px 12px;gap:9px}
.exam-tabs{display:flex}
.exam-split{display:flex}
.exam-pane{min-width:0}
.exam-pane-p,.exam-pane-q{display:flex;flex-direction:column}
.exam-pane-p{flex:1}
.exam-pane-q{flex:1}
.exam-split[data-pane="passage"] .exam-pane-q{display:none}
.exam-split[data-pane="questions"] .exam-pane-p{display:none}
@media (min-width:1024px){
  .exam-top{padding:12px 20px;gap:14px}
  .exam-tabs{display:none}
  .exam-pane-p{flex:1.15}
  .exam-pane-q{flex:none;width:460px}
  .exam-split[data-pane="passage"] .exam-pane-q,
  .exam-split[data-pane="questions"] .exam-pane-p{display:flex}
}
`;

const S: Record<string, React.CSSProperties> = {
  shell: { height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)" },

  // padding/gap → .exam-top (адаптив)
  top: { display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", flex: "none" },
  tabs: { flex: "none", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)" },
  exit: { flex: "none", width: 38, height: 38, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", color: "var(--text-secondary)", textDecoration: "none" },
  topTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  topMeta: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  audioBar: { padding: "16px 24px", background: "var(--bg-raised)", borderBottom: "1px solid var(--border)", flex: "none" },

  sheetHead: { display: "flex", alignItems: "center", marginBottom: 14 },
  sheetHint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },

  // width/flex/display → .exam-pane-q (адаптив)
  qPane: { flexDirection: "column", background: "var(--bg-base)" },

  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", boxShadow: "var(--shadow-solid)" },
  qNum: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)", width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 },
  qPrompt: { flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", lineHeight: 1.5, paddingTop: 3 },
};
