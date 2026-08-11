"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { categoryLabel } from "@/lib/labels";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { AudioPlayer } from "@/components/exam/AudioPlayer";
import { ExamTimer } from "@/components/exam/ExamTimer";
import { QuestionNavigator, type NavPart } from "@/components/exam/QuestionNavigator";
import { QuestionHtml } from "@/components/exam/QuestionHtml";
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

type ExamMode = "practice" | "mock";
interface StoredMode {
  mode: ExamMode;
  startedAt: number;
  deadline: number | null;
}
const MODE_KEY = (id: string) => `bando-exam-mode:${id}`;
/** Режим теста (Practice/Mock) — клиентский, переживает refresh через localStorage,
 *  keyed по attemptId. Хранилище может быть недоступно (private mode) → мягкая деградация. */
function readStoredMode(id: string): StoredMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredMode>;
    if ((v.mode === "practice" || v.mode === "mock") && typeof v.startedAt === "number") {
      return { mode: v.mode, startedAt: v.startedAt, deadline: typeof v.deadline === "number" ? v.deadline : null };
    }
  } catch {
    /* storage недоступен / битый JSON — режим просто не восстановим */
  }
  return null;
}
function writeStoredMode(id: string, v: StoredMode): void {
  try {
    localStorage.setItem(MODE_KEY(id), JSON.stringify(v));
  } catch {
    /* storage недоступен (private mode/quota) — режим не сохранится, не критично */
  }
}

// Listening: окно переноса/проверки ответов после конца записи (как в Cambridge-симуляторе).
const TRANSFER_SECONDS = 2 * 60;
const AUDIO_KEY = (id: string) => `bando-audio-start:${id}`;
/** Момент первого Play записи (ms) — клиентский якорь single-pass: refresh резюмит с реальной
 *  позиции (forward-seek), реплея нет. keyed по attemptId; storage может быть недоступен. */
function readAudioStart(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(AUDIO_KEY(id)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeAudioStart(id: string, ms: number): void {
  try {
    localStorage.setItem(AUDIO_KEY(id), String(ms));
  } catch {
    /* storage недоступен — single-pass якорь не сохранится (degraded, не критично) */
  }
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
  mode,
  mockMinutes,
  initialAnswers,
  passages,
  questions,
  durationSeconds,
  audioSrc,
  title,
  category,
  initialAnnotations,
  questionsHtml,
}: {
  attemptId: string;
  contentItemId: string;
  /** Режим попытки (P0) — серверная истина из attempt.mode, клиент его не выбирает. */
  mode: ExamMode;
  /** Лимит mock в минутах (выбран на ModeStart, clamp на сервере). */
  mockMinutes: number;
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
  /** Verbatim question-panel HTML (real-IELTS render); null → atomized fallback. */
  questionsHtml?: string | null;
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

  const isListening = !!audioSrc;
  // Practice/Mock (P0) — серверная сущность: mode приходит пропом из attempt.mode
  // (рейтинг/дневной кап ветвятся на сервере). Клиенту остаётся только ТАЙМИНГ:
  // wall-clock якоря (startedAt/deadline) живут в localStorage, чтобы refresh не
  // сбрасывал Mock-отсчёт; серверное время от started_at — истина для anti-cheat,
  // Mock-таймер и авто-сабмит чисто клиентские (авто-сабмит зовёт обычный submitAttempt).
  const [hydrated, setHydrated] = useState(false);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [practiceSeconds, setPracticeSeconds] = useState(0);
  const [mockRemaining, setMockRemaining] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const autoSubmitted = useRef(false);
  const submitRef = useRef<() => void>(() => {});

  // Listening: раннер владеет <audio>. Строгий single-pass (шаг 3): без паузы/seek/replay,
  // таймер привязан к записи, после конца — окно transfer. Старт/резюм — через gate-оверлей.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioCur, setAudioCur] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const [audioPhase, setAudioPhase] = useState<"gate" | "playing" | "transfer">("gate");
  const [buffered, setBuffered] = useState(0);
  const [canPlay, setCanPlay] = useState(false);
  const [audRemaining, setAudRemaining] = useState<number | null>(null);
  const [transferRemaining, setTransferRemaining] = useState<number | null>(null);
  const audioStartedAtRef = useRef<number | null>(null);
  const resumeDecided = useRef(false);

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

  // useCallback → стабильная ссылка onJump, чтобы memo(QuestionNavigator) не ломался
  // на каждый тик таймера (setCurrent/setPane/qScrollRef стабильны, deps пусты).
  const jump = useCallback((n: number) => {
    setCurrent(n);
    setPane("questions"); // на мобильном гарантируем, что таб вопросов активен
    const el = document.getElementById(`q-${n}`);
    const wrap = qScrollRef.current;
    if (el && wrap) wrap.scrollTo({ top: el.offsetTop - 14, behavior: "smooth" });
  }, []);

  // submitRef держит свежий submit (с актуальными answers) для авто-сабмита из таймера.
  useEffect(() => {
    submitRef.current = submit;
  });

  // Гидрация ТАЙМИНГА из localStorage (после mount — SSR не знает storage). Режим
  // задан сервером; storage хранит только wall-clock якоря. Совпадающая запись →
  // продолжаем отсчёт (refresh не сбрасывает Mock-дедлайн); нет записи или запись
  // от другого режима (смена режима между попытками) → старт с чистых якорей.
  useEffect(() => {
    if (isListening) {
      // single-pass якорь: если запись уже запускали — продолжим с реальной позиции (эффекты ниже).
      const s = readAudioStart(attemptId);
      if (s) audioStartedAtRef.current = s;
      setHydrated(true);
      return;
    }
    const now = Date.now();
    const stored = readStoredMode(attemptId);
    if (stored && stored.mode === mode) {
      startedAtRef.current = stored.startedAt;
      deadlineRef.current = stored.deadline;
      if (mode === "practice") {
        setPracticeSeconds(Math.max(0, Math.floor((now - stored.startedAt) / 1000)));
      }
    } else {
      const deadline = mode === "mock" ? now + mockMinutes * 60_000 : null;
      startedAtRef.current = now;
      deadlineRef.current = deadline;
      writeStoredMode(attemptId, { mode, startedAt: now, deadline });
    }
    if (mode === "mock" && deadlineRef.current != null) {
      setMockRemaining(Math.max(0, Math.round((deadlineRef.current - now) / 1000)));
    }
    setStarted(true);
    setHydrated(true);
  }, [attemptId, isListening, mode, mockMinutes]);

  // Practice: счёт вверх, замирает на паузе (интервал гейтится paused).
  useEffect(() => {
    if (isListening || !started || mode !== "practice" || paused) return;
    const t = setInterval(() => setPracticeSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isListening, started, mode, paused]);

  // Mock: обратный отсчёт от wall-clock дедлайна (refresh-корректно).
  useEffect(() => {
    if (isListening || !started || mode !== "mock") return;
    const tick = () => {
      const dl = deadlineRef.current;
      if (dl != null) setMockRemaining(Math.max(0, Math.round((dl - Date.now()) / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isListening, started, mode]);

  // Mock авто-сабмит при 0 (единожды). Клиент лишь инициирует — сервер считает время и грейдит.
  useEffect(() => {
    if (mode === "mock" && started && mockRemaining === 0 && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submitRef.current();
    }
  }, [mode, started, mockRemaining]);

  const togglePause = () => setPaused((p) => !p);
  const restart = () => {
    if (typeof window !== "undefined" && !window.confirm("Restart this test? Your answers and timing will be cleared.")) return;
    setAnswers({});
    setFlags({});
    setCurrent(questions[0]?.number ?? 1);
    const now = Date.now();
    startedAtRef.current = now;
    autoSubmitted.current = false;
    setPaused(false);
    setPracticeSeconds(0);
    // Кнопка живёт только в practice-ветке — mode здесь всегда "practice".
    writeStoredMode(attemptId, { mode, startedAt: now, deadline: null });
  };
  const mockTotalSeconds = () => {
    const dl = deadlineRef.current;
    const st = startedAtRef.current;
    return dl != null && st != null ? Math.max(1, Math.round((dl - st) / 1000)) : 60;
  };

  // Listening single-pass: при возврате после refresh решаем фазу по реальному времени.
  useEffect(() => {
    if (!isListening || audioDur <= 0 || resumeDecided.current) return;
    resumeDecided.current = true;
    const anchor = audioStartedAtRef.current;
    if (anchor == null) return; // свежий тест → остаёмся на gate (fresh)
    const elapsed = (Date.now() - anchor) / 1000;
    if (elapsed >= audioDur + TRANSFER_SECONDS) {
      if (!autoSubmitted.current) {
        autoSubmitted.current = true;
        submitRef.current();
      }
    } else if (elapsed >= audioDur) {
      setAudioPhase("transfer");
      setTransferRemaining(Math.max(0, Math.round(audioDur + TRANSFER_SECONDS - elapsed)));
    }
    // elapsed < audioDur → gate(resume): тап продолжит с позиции; время ведёт heartbeat ниже.
  }, [isListening, audioDur]);

  // Listening heartbeat: остаток записи / transfer, переход в transfer и авто-сабмит по wall-clock.
  useEffect(() => {
    if (!isListening) return;
    const tick = () => {
      const anchor = audioStartedAtRef.current;
      if (anchor == null || audioDur <= 0) return;
      const elapsed = (Date.now() - anchor) / 1000;
      if (elapsed < audioDur) {
        setAudRemaining(Math.max(0, Math.round(audioDur - elapsed)));
      } else {
        setTransferRemaining(Math.max(0, Math.round(audioDur + TRANSFER_SECONDS - elapsed)));
        setAudioPhase("transfer");
        if (elapsed >= audioDur + TRANSFER_SECONDS && !autoSubmitted.current) {
          autoSubmitted.current = true;
          submitRef.current();
        }
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isListening, audioDur]);

  // В transfer звук останавливаем (на случай, если переход опередил событие ended).
  useEffect(() => {
    if (audioPhase === "transfer" && audioRef.current) audioRef.current.pause();
  }, [audioPhase]);

  // Старт/резюм записи (требует жеста — из gate-оверлея). Fresh: с 0 + якорь.
  // Resume: forward-seek к реальной позиции (реплея нет).
  const playAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    const anchor = audioStartedAtRef.current;
    if (anchor == null) {
      const now = Date.now();
      audioStartedAtRef.current = now;
      writeAudioStart(attemptId, now);
      try {
        a.currentTime = 0;
      } catch {
        /* seek до буфера может не пройти — не критично */
      }
    } else {
      const elapsed = (Date.now() - anchor) / 1000;
      try {
        a.currentTime = Math.max(0, elapsed);
      } catch {
        /* forward-seek не прошёл — продолжим с текущей позиции */
      }
    }
    setAudioPhase("playing");
    void a.play().catch(() => {
      /* воспроизведение не стартовало — вернём gate, пользователь попробует снова */
      setAudioPhase("gate");
    });
  };

  const meta = `${categoryLabel(category)} · ${questions.length} questions`;

  // useMemo: partGroups зависит только от [questions, answers, flags] — тик таймера
  // их не меняет, поэтому memo(QuestionNavigator) ниже получает ту же ссылку и не
  // ре-рендерится 1/сек (на Listening — до ~4/сек из-за onTimeUpdate).
  const partGroups = useMemo(() => buildParts(questions, answers, flags), [questions, answers, flags]);

  // Таймер шапки: Listening — по записи (audio remaining → transfer); Reading после
  // гидрации/старта — по режиму; до гидрации Reading — прежнее поведение.
  let timerArea: React.ReactNode;
  if (isListening) {
    if (audioDur <= 0) {
      timerArea = (
        <span style={S.clock}>
          <Icon name="clock" size={18} style={{ color: "var(--text-muted)" }} /> --:--
        </span>
      );
    } else if (audioPhase === "transfer") {
      timerArea = (
        <>
          <span className="exam-mode-badge" style={badge(true)}>Transfer</span>
          <ExamTimer remainingSeconds={transferRemaining ?? TRANSFER_SECONDS} totalSeconds={TRANSFER_SECONDS} />
        </>
      );
    } else {
      timerArea = (
        <>
          {/* P0: режим — серверная истина; в Listening поведение пока одинаковое
              (single-pass), но рейтинг/кап различаются — бейдж показывает честно. */}
          <span className="exam-mode-badge" style={badge(mode === "mock")}>{mode === "mock" ? "Mock" : "Practice"}</span>
          <ExamTimer remainingSeconds={audRemaining ?? audioDur} totalSeconds={audioDur} />
        </>
      );
    }
  } else if (hydrated && started) {
    if (mode === "mock") {
      const total = mockTotalSeconds();
      timerArea = (
        <>
          <span className="exam-mode-badge" style={badge(true)}>Mock</span>
          <ExamTimer remainingSeconds={mockRemaining ?? total} totalSeconds={total} />
        </>
      );
    } else {
      timerArea = (
        <>
          <span className="exam-mode-badge" style={badge(false)}>Practice</span>
          <span style={S.clock}>
            <Icon name={paused ? "pause" : "clock"} size={18} style={{ color: "var(--text-muted)" }} /> {fmt(practiceSeconds)}
          </span>
          <button type="button" onClick={togglePause} aria-label={paused ? "Resume timer" : "Pause timer"} title={paused ? "Resume" : "Pause"} className="exam-ctrl" style={S.ctrlBtn}>
            <Icon name={paused ? "play" : "pause"} size={16} />
          </button>
          <button type="button" onClick={restart} aria-label="Restart test" title="Restart test" className="exam-ctrl-text" style={S.ctrlBtnText}>
            Restart
          </button>
        </>
      );
    }
  } else {
    timerArea =
      durationSeconds != null && remaining != null ? (
        <ExamTimer remainingSeconds={remaining} totalSeconds={durationSeconds} />
      ) : (
        <span style={S.clock}>
          <Icon name="clock" size={18} style={{ color: "var(--text-muted)" }} /> {fmt(elapsed)}
        </span>
      );
  }

  // useMemo: список вопросов перестраивается лишь при смене ответов/флагов/набора
  // вопросов, не на каждый тик таймера. Колбэки стабильны (useCallback) → элементы
  // QuestionBlock переиспользуются, его memo продолжает работать.
  const questionList = useMemo(
    () =>
      questions.map((q) => (
        <QuestionBlock
          key={q.id}
          q={q}
          value={answers[String(q.number)] ?? ""}
          flagged={!!flags[String(q.number)]}
          onAnswer={set}
          onToggle={toggle}
          onFlag={flag}
        />
      )),
    [questions, answers, flags, set, toggle, flag],
  );

  return (
    <div className="exam-cambridge" style={S.shell}>
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
        <div className="exam-top-right" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          {timerArea}
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
                    preload="auto"
                    onLoadedMetadata={(e) => setAudioDur(e.currentTarget.duration || 0)}
                    onTimeUpdate={(e) => setAudioCur(e.currentTarget.currentTime)}
                    onProgress={(e) => {
                      const a = e.currentTarget;
                      if (a.duration > 0 && a.buffered.length > 0) {
                        setBuffered(Math.min(1, a.buffered.end(a.buffered.length - 1) / a.duration));
                      }
                    }}
                    onCanPlay={() => setCanPlay(true)}
                    onError={() => setCanPlay(true)}
                    onEnded={() => setAudioPhase("transfer")}
                    style={{ display: "none" }}
                  />
                  {audioPhase === "transfer" ? (
                    <div style={S.transferBanner}>
                      <Icon name="pencil-check" size={18} style={{ color: "var(--brand)" }} />
                      <span>Recording finished — use the transfer time to check and complete your answers.</span>
                    </div>
                  ) : (
                    <AudioPlayer
                      progress={audioDur > 0 ? audioCur / audioDur : 0}
                      playing={audioPhase === "playing"}
                      totalSeconds={audioDur}
                      locked
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div ref={qScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 24px 48px" }}>
              <div style={S.sheetHead}>
                <span style={S.sheetHint}>Answer as you listen — the recording plays once.</span>
              </div>
              {questionList}
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
              {questionsHtml ? (
                <QuestionHtml html={questionsHtml} answers={answers} onAnswer={set} onToggle={toggle} fallback={questionList} />
              ) : (
                questionList
              )}
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

      {isListening && hydrated && audioPhase === "gate" && (
        <ListeningGate
          resume={audioStartedAtRef.current != null}
          buffered={buffered}
          canPlay={canPlay}
          onPlay={playAudio}
        />
      )}
    </div>
  );
}

// Общий стиль кнопки-варианта (radio/checkbox) — один источник, чтобы две ветки
// не расходились визуально.
// Инлайн-поле пропуска (sentence/note completion) — встроено в предложение, как в реальном IELTS.
const inlineGapInput = (filled: boolean): React.CSSProperties => ({
  display: "inline-block",
  minWidth: 110,
  maxWidth: 220,
  height: 30,
  margin: "0 5px",
  padding: "0 9px",
  verticalAlign: "baseline",
  borderRadius: "var(--radius-sm)",
  border: `1px solid ${filled ? "var(--brand)" : "var(--border-strong)"}`,
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  outline: "none",
});

const optBtn = (sel: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  textAlign: "left",
  padding: "9px 12px",
  minHeight: 40,
  borderRadius: "var(--radius-md)",
  border: `1px solid ${sel ? "var(--brand)" : "var(--border)"}`,
  background: sel ? "var(--brand-subtle)" : "transparent",
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

// Бейдж режима (Practice/Mock) в шапке.
const badge = (mock: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 10px",
  borderRadius: "var(--radius-sm)",
  background: mock ? "var(--brand-subtle)" : "var(--surface-hover)",
  color: mock ? "var(--brand)" : "var(--text-secondary)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-2xs)",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
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

  // Note/sentence-completion: вставляем поле ПРЯМО в пропуск (≥3 подчёркивания) —
  // «he left [поле] for financial reasons», как в реальном IELTS, а не поле снизу.
  // Только при ровно одном пропуске; иначе — обычное поле снизу.
  const gapParts = !hasOptions ? q.prompt_html.split(/_{3,}/) : null;
  const inlineGap = gapParts != null && gapParts.length === 2;

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
          <div style={S.qPrompt}>
            {inlineGap ? (
              <>
                {gapParts![0]}
                <input
                  value={single}
                  onChange={(e) => onAnswer(q.number, e.target.value)}
                  aria-label={`Answer for question ${q.number}`}
                  autoComplete="off"
                  className="exam-gap-input"
                  style={inlineGapInput(!!single)}
                />
                {gapParts![1]}
              </>
            ) : (
              q.prompt_html
            )}
          </div>
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
        {!inlineGap && (
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
                    className="exam-opt"
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
                    className="exam-opt"
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
              className="exam-answer-input"
              style={{ width: "100%", maxWidth: 280, height: 40, padding: "0 12px", borderRadius: "var(--radius-md)", border: `1px solid ${single ? "var(--brand)" : "var(--border)"}`, background: "var(--surface-raised)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", outline: "none" }}
            />
          )}
        </div>
        )}
      </div>
    </div>
  );
});

/**
 * ListeningGate — оверлей старта/резюма записи Listening (single-pass). Показывает буфер
 * загрузки; Play активна когда хватает буфера. Resume-вариант — после refresh: продолжить
 * с реальной позиции (без реплея).
 */
function ListeningGate({
  resume,
  buffered,
  canPlay,
  onPlay,
}: {
  resume: boolean;
  buffered: number;
  canPlay: boolean;
  onPlay: () => void;
}) {
  return (
    <div className="exam-overlay" style={SS.overlay} role="dialog" aria-modal="true" aria-label="Listening recording">
      <div style={{ ...SS.panel, maxWidth: 460, textAlign: "center" }}>
        <span style={{ ...SS.cardIcon, width: 52, height: 52, margin: "0 auto 14px", background: "var(--brand-subtle)", color: "var(--brand)" }}>
          <Icon name="headphones" size={26} />
        </span>
        <h1 style={SS.startTitle}>{resume ? "Continue the recording" : "Listening test"}</h1>
        <p style={SS.startMeta}>
          {resume
            ? "The recording kept playing while you were away. It resumes from the current point — no rewind or replay."
            : "The recording plays once. You can't pause, rewind, or replay it — answer as you listen."}
        </p>
        <div style={SS.bufferTrack} aria-hidden="true">
          <div style={{ ...SS.bufferFill, width: `${Math.round(buffered * 100)}%` }} />
        </div>
        <p style={SS.bufferLabel}>{canPlay ? "Audio ready" : `Loading audio… ${Math.round(buffered * 100)}%`}</p>
        <Button variant="primary" fullWidth disabled={!canPlay} trailingIcon="arrow-right" onClick={onPlay}>
          {resume ? "Resume" : "Play recording"}
        </Button>
      </div>
    </div>
  );
}

// Стили оверлея ListeningGate (после P0 выбор режима уехал на серверный ModeStart,
// здесь остался только gate записи).
const SS: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", overflowY: "auto", padding: 20, background: "color-mix(in oklab, var(--bg-base) 82%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" },
  panel: { width: "100%", maxWidth: 620, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)", padding: "28px 26px" },
  startTitle: { margin: "8px 0 4px", fontFamily: "var(--font-reading)", fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.15 },
  startMeta: { margin: "0 0 20px", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" },
  cardIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--surface-hover)", color: "var(--text-secondary)" },
  bufferTrack: { height: 6, borderRadius: 999, background: "var(--surface-hover)", overflow: "hidden", margin: "6px 0" },
  bufferFill: { height: "100%", background: "var(--brand)", borderRadius: 999, transition: "width 200ms linear" },
  bufferLabel: { margin: "0 0 16px", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" },
};

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

/* Мобильный проход (≤430px): правый кластер шапки переносится (иначе Submit клиппит
   overflow:hidden shell), оверлеи прижаты к верху и скроллятся при высокой панели,
   тап-таргеты ≥44px. Планшет/десктоп (>430px) не затрагиваются. */
@media (max-width:430px){
  .exam-top-right{flex-wrap:wrap;justify-content:flex-end;gap:8px!important}
  .exam-tabs button{height:44px!important}
  .exam-exit{width:44px!important;height:44px!important}
  .exam-ctrl{width:44px!important;height:44px!important}
  .exam-ctrl-text{height:44px!important}
  .exam-opt{min-height:44px!important}
  /* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
  .exam-gap-input{min-width:80px!important;max-width:100%!important;min-height:44px!important;font-size:16px!important}
  .exam-answer-input{font-size:16px!important}
  .exam-overlay{align-items:start!important}
  /* Бейдж режима (Practice/Mock/Transfer) — смысловой лейбл, поднимаем до 12px. */
  .exam-mode-badge{font-size:12px!important}
}

/* === Cambridge skin (шаг 4): бело-сине-графитовый вид реального computer-IELTS.
   Переопределяем дизайн-токены на корне раннера — шапка/навигатор/таймер/карточки/
   оверлеи/пассаж перекрашиваются разом. Шрифты НЕ трогаем (бренд-штрих по решению).
   Структура/логика/аннотации те же — меняются только цвета и «плоскость». === */
.exam-cambridge{
  --bg-base:#eef3f8;--bg-raised:#ffffff;--surface:#ffffff;--surface-raised:#ffffff;
  --surface-hover:#eaf1fb;--surface-inset:#e6eef7;
  --border:#cfe0f0;--border-strong:#9fc6ea;
  --brand:#2563eb;--brand-hover:#1d4ed8;--brand-edge:#1e40af;--brand-subtle:#e8f1fe;
  --text-primary:#111827;--text-secondary:#374151;--text-muted:#6b7280;--text-on-brand:#ffffff;
  --neutral-edge:#cbd5e1;--shadow-solid:0 1px 2px rgba(17,24,39,.06);--shadow-lg:0 10px 30px rgba(17,24,39,.13);
  --warn:#f59e0b;--warn-subtle:#fef3c7;--warn-text:#92400e;--error:#dc2626;
  --reading-text:#111827;--reading-surface:#ffffff;--reading-rule:#cfe0f0;--reading-muted:#6b7280;--reading-mark:rgb(253 224 71);
  /* Плоская геометрия + sans-пассаж (наш Jakarta) — ближе к реальному computer-IELTS. */
  --radius-lg:6px;--radius-md:6px;--radius-sm:5px;
  --font-reading:var(--font-ui);
}
/* Пассаж под Cambridge: без буквицы; буквы абзацев — плоские (нужны для paragraph-matching), не кружки. */
.exam-cambridge .bando-reading.editorial p.rp{padding-left:26px}
.exam-cambridge .bando-reading.editorial p.rp::before{
  border:none;background:transparent;width:auto;height:auto;top:.04em;
  font-family:var(--font-ui);font-weight:700;font-size:.9em;color:var(--text-secondary);
}
.exam-cambridge .bando-reading.editorial p.rp[data-first]::first-letter{
  float:none;font-size:inherit;line-height:inherit;font-weight:inherit;padding:0;color:inherit;
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
  qPane: { flexDirection: "column", background: "var(--surface)" },

  clock: { display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-lg)", fontWeight: 500, color: "var(--text-primary)" },
  ctrlBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-secondary)", cursor: "pointer", transition: "var(--transition-colors)" },
  ctrlBtnText: { display: "inline-flex", alignItems: "center", height: 38, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text-secondary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, transition: "var(--transition-colors)" },
  transferBanner: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--radius-lg)", border: "2px solid var(--brand)", background: "var(--brand-subtle)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 },

  card: { background: "transparent", border: "none", borderBottom: "1px solid var(--border)", borderRadius: 0, padding: "16px 2px", boxShadow: "none" },
  qNum: { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)", width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 },
  qPrompt: { flex: 1, minWidth: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", color: "var(--text-primary)", lineHeight: 1.5, paddingTop: 3 },
};
