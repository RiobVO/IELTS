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
import { checkAnswer, locateEvidence, reviewMistake, revealQuestion, type RevealResult } from "./practice-actions";
import { reportClientError } from "@/lib/monitoring/report-client-error";
import { countWords, parseChoiceCount, parseWordLimit } from "@/lib/exam/format-guard";
import { strategyHints } from "@/lib/exam/strategy-hints";
import { parseConfidenceMap, type ConfidenceLevel } from "@/lib/practice/confidence-calibration";

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

/* --- P4 Reader comfort (practice reading only). Префы ГЛОБАЛЬНЫЕ (не per-attempt),
   применяются к пассажу через PassagePane (font/leading/theme). --- */
type ReaderTheme = "default" | "sepia";
interface ReaderPrefs {
  size: 0 | 1 | 2;
  leading: 0 | 1;
  theme: ReaderTheme;
  /** Own-A — pacing coach (чип темпа у practice-таймера Reading). Дефолт вкл. */
  pace: boolean;
}
/** Вход PassagePane: разрешённые размер/интерлиньяж/тема пассажа. */
type ReaderInput = { fontPx: number; lineHeight: number; theme: "paper" | "sepia" };
const READER_PREFS_KEY = "bando-reading-prefs";
const READER_FONT_PX = [16, 19, 22];
const READER_LEADING = [1.75, 2.05];
const READER_DEFAULT: ReaderPrefs = { size: 1, leading: 0, theme: "default", pace: true };

function readReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(READER_PREFS_KEY);
    if (!raw) return READER_DEFAULT;
    const v = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      size: v.size === 0 || v.size === 1 || v.size === 2 ? v.size : 1,
      leading: v.leading === 0 || v.leading === 1 ? v.leading : 0,
      theme: v.theme === "sepia" ? "sepia" : "default",
      // Дефолт коуча — вкл; выключается явно (persist false).
      pace: v.pace === false ? false : true,
    };
  } catch {
    /* storage недоступен / битый JSON — дефолтные префы */
    return READER_DEFAULT;
  }
}

/* --- P10 Confidence-метки (practice-only, reading+listening атомизированные).
   Клиентские, per-attempt: карта {номер вопроса → уровень} в localStorage
   `bando-confidence-<attemptId>`. Читается на /result островом калибровки. Сервера
   нет. Мусор отбрасывает parseConfidenceMap (общий с /result). --- */
const CONFIDENCE_KEY = (id: string) => `bando-confidence-${id}`;
function readConfidence(id: string): Record<string, ConfidenceLevel> {
  try {
    return parseConfidenceMap(localStorage.getItem(CONFIDENCE_KEY(id)));
  } catch {
    return {}; // storage недоступен — метки просто не восстановим
  }
}
function writeConfidence(id: string, map: Record<string, ConfidenceLevel>): void {
  try {
    localStorage.setItem(CONFIDENCE_KEY(id), JSON.stringify(map));
  } catch {
    /* storage недоступен (private/quota) — метки не сохранятся, не критично */
  }
}

/* --- P5 Микро-цели/брейки (practice-only, локальная форма). Prefs ГЛОБАЛЬНЫЕ
   (не per-attempt) в отдельном ключе — применимы и к reading, и к listening
   practice. Без XP/стриков/персиста на сервер. --- */
const PRACTICE_GOAL_KEY = "bando-practice-goal";
const GOAL_CHOICES = [5, 10, 20] as const;
const BREAK_CHOICES = [15, 25] as const;
type GoalValue = 5 | 10 | 20 | "all";
interface GoalPrefs {
  goal: GoalValue | null;
  breakMin: 15 | 25 | null;
}
const GOAL_DEFAULT: GoalPrefs = { goal: null, breakMin: null };
function readGoalPrefs(): GoalPrefs {
  try {
    const raw = localStorage.getItem(PRACTICE_GOAL_KEY);
    // Кап длины перед парсом: prefs — десятки байт, гигантская строка = мусор/self-DoS.
    if (!raw || raw.length > 1024) return GOAL_DEFAULT;
    const v = JSON.parse(raw) as Partial<GoalPrefs>;
    const goal: GoalValue | null =
      v.goal === "all" || v.goal === 5 || v.goal === 10 || v.goal === 20 ? v.goal : null;
    const breakMin: 15 | 25 | null = v.breakMin === 15 || v.breakMin === 25 ? v.breakMin : null;
    return { goal, breakMin };
  } catch {
    return GOAL_DEFAULT;
  }
}
function writeGoalPrefs(v: GoalPrefs): void {
  try {
    localStorage.setItem(PRACTICE_GOAL_KEY, JSON.stringify(v));
  } catch {
    /* storage недоступен — цель/брейки не сохранятся, не критично */
  }
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
  focus,
  locatable,
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
  /** P15 — номер вопроса для авто-скролла на маунте (deep-link practice). undefined в mock. */
  focus?: number;
  /** P2b-2 — номера вопросов с локатором ДО reveal (practice-reading). undefined в
   *  mock/listening → «Where to look?» не рендерится. Булево «есть локатор», не para. */
  locatable?: number[];
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
  // P8 (practice Listening Lab): аудио разлочено — play/pause/seek/replay/скорость. mock
  // остаётся строгим single-pass (anchor/transfer/авто-сабмит ниже гейтятся mode==="mock").
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioRate, setAudioRate] = useState(1);

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

  // P6/P7 — обучающая петля practice: клиентские, НЕ персистятся (в отличие от answers).
  // verdict = результат мгновенной проверки, reveal = раскрытый ключ, checkBusy = pending
  // конкретного вопроса. В mock эти карты ВСЕГДА пусты (Check/Show не рендерятся), поэтому
  // mock-ветка QuestionBlock не затрагивается ни на байт.
  const isPractice = mode === "practice";
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, RevealResult>>({});
  const [checkBusy, setCheckBusy] = useState<Record<string, boolean>>({});
  // P14 — сколько раз ответ вопроса проверен и оказался неверным (клиентский счётчик,
  // НЕ сбрасывается при смене ответа: одна повторная попытка на вопрос). После 2-го
  // неверного чека открываем reveal-ссылку. В mock всегда пуст (PracticeCheck не рендерится).
  const [wrongTries, setWrongTries] = useState<Record<string, number>>({});

  // P10 — метки уверенности (practice-only): клиентские, per-attempt, персист в
  // localStorage. Гидрация из storage на маунте; запись гейтится confHydrated
  // (state, не ref) — иначе первый write эффекта на маунте затёр бы сохранённое
  // пустой картой (эффект видит confidence={} до применения setState). В mock
  // всегда пуст (isPractice=false → эффекты no-op, чип не рендерится).
  const [confidence, setConfidence] = useState<Record<string, ConfidenceLevel>>({});
  const [confHydrated, setConfHydrated] = useState(false);
  useEffect(() => {
    if (!isPractice) return;
    setConfidence(readConfidence(attemptId));
    setConfHydrated(true);
  }, [isPractice, attemptId]);
  useEffect(() => {
    if (!isPractice || !confHydrated) return;
    writeConfidence(attemptId, confidence);
  }, [isPractice, attemptId, confidence, confHydrated]);
  // Тап по уровню: тот же уровень снова → снять метку (метка опциональна). Стабильна.
  const setConf = useCallback((n: number, level: ConfidenceLevel) => {
    setConfidence((c) => {
      const k = String(n);
      const next = { ...c };
      if (next[k] === level) delete next[k];
      else next[k] = level;
      return next;
    });
  }, []);

  // P4 — комфорт чтения только в practice-reading (у Listening пассажа нет). Префы
  // глобальные (localStorage), применяются к PassagePane. mock/listening панель не рендерят.
  const readerActive = !isListening && isPractice;
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(READER_DEFAULT);
  const [readerOpen, setReaderOpen] = useState(false);
  useEffect(() => {
    if (readerActive) setReaderPrefs(readReaderPrefs()); // client-only → без SSR-mismatch
  }, [readerActive]);
  useEffect(() => {
    if (!readerActive) return;
    try {
      localStorage.setItem(READER_PREFS_KEY, JSON.stringify(readerPrefs));
    } catch {
      /* storage недоступен (private/quota) — префы не сохранятся, не критично */
    }
  }, [readerActive, readerPrefs]);
  // Мемо по примитивным префам: тик таймера не меняет ссылку → memo(PassagePane) держится
  // (тяжёлый рендер body_html не повторяется 1/сек), пересчёт только на смену настройки.
  const readerFor = useMemo<ReaderInput | undefined>(
    () =>
      readerActive
        ? {
            fontPx: READER_FONT_PX[readerPrefs.size] ?? 19,
            lineHeight: READER_LEADING[readerPrefs.leading] ?? 1.75,
            theme: readerPrefs.theme === "sepia" ? "sepia" : "paper",
          }
        : undefined,
    // Зависим ТОЛЬКО от визуальных полей: переключение pace-коуча не должно менять
    // ссылку readerFor (иначе memo(PassagePane) зря ре-рендерится).
    [readerActive, readerPrefs.size, readerPrefs.leading, readerPrefs.theme],
  );

  // Изменение ответа делает прежний вердикт устаревшим — снимаем его (раскрытый ключ
  // не трогаем: правильный ответ от смены ввода не меняется). Стабильна (deps пусты).
  const dropVerdict = useCallback((n: number) => {
    setChecked((c) => {
      const k = String(n);
      if (!(k in c)) return c; // в mock/непроверенном — no-op, лишнего рендера нет
      const next = { ...c };
      delete next[k];
      return next;
    });
  }, []);

  const runCheck = useCallback(
    (n: number, v: string | string[]) => {
      setCheckBusy((b) => ({ ...b, [n]: true }));
      void checkAnswer(attemptId, n, v)
        .then((res) => {
          if (!res) return;
          setChecked((c) => ({ ...c, [n]: res.correct }));
          // P14: неверный чек копит попытку; на 2-й открывается reveal-ссылка.
          if (!res.correct) setWrongTries((w) => ({ ...w, [n]: (w[n] ?? 0) + 1 }));
        })
        .catch((e) => {
          console.error("checkAnswer call failed", e);
          reportClientError(e, "checkAnswer call failed");
        })
        .finally(() => setCheckBusy((b) => ({ ...b, [n]: false })));
      // Учебная петля: если проверяем именно вопрос из очереди ошибок (focus), пишем
      // SR-ревью (тот же гейт practice; сервер грейдит сам, verdict клиента не шлём).
      // Fire-and-forget — сбой не ломает UX проверки. Не-focus и mock (focus==null) не трогаем.
      if (focus != null && n === focus) {
        void reviewMistake(attemptId, n, v).catch((e) => {
          console.error("reviewMistake call failed", e);
          reportClientError(e, "reviewMistake call failed");
        });
      }
    },
    [attemptId, focus],
  );

  const runReveal = useCallback(
    (n: number) => {
      setCheckBusy((b) => ({ ...b, [n]: true }));
      void revealQuestion(attemptId, n)
        .then((res) => {
          if (res) setRevealed((r) => ({ ...r, [n]: res }));
        })
        .catch((e) => {
          console.error("revealQuestion call failed", e);
          reportClientError(e, "revealQuestion call failed");
        })
        .finally(() => setCheckBusy((b) => ({ ...b, [n]: false })));
    },
    [attemptId],
  );

  // useCallback → стабильные ссылки, чтобы memo(QuestionBlock) реально срабатывал
  // (functional setState, deps пусты).
  const set = useCallback(
    (n: number, v: string) => {
      setAnswers((a) => ({ ...a, [String(n)]: v }));
      dropVerdict(n);
    },
    [dropVerdict],
  );
  // mcq_multi: переключаем букву в наборе ответа (string[]). Порядок грейдеру не важен
  // (mcq_set сверяет множества), сортируем лишь для стабильного отображения.
  const toggle = useCallback(
    (n: number, letter: string) => {
      setAnswers((a) => {
        const cur = a[String(n)];
        const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
        const next = arr.includes(letter)
          ? arr.filter((x) => x !== letter)
          : [...arr, letter].sort();
        return { ...a, [String(n)]: next };
      });
      dropVerdict(n);
    },
    [dropVerdict],
  );
  const flag = useCallback((n: number) => setFlags((f) => ({ ...f, [String(n)]: !f[String(n)] })), []);

  // P2b-1 — локатор абзаца пассажа после reveal. Раннер лишь диспатчит событие; DOM-резолв
  // и пульс-подсветка живут в PassagePane (владелец разметки пассажа). На мобильном сперва
  // показываем панель пассажа, затем (следующий кадр — панель уже раскрыта из display:none)
  // шлём событие. Десктоп игнорирует setPane (обе панели видны). Стабильна (deps пусты).
  const locatePara = useCallback((para: string) => {
    setPane("passage");
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("exam:locate-para", { detail: { para } }));
    });
  }, []);

  // P2b-2 — множество вопросов с локатором ДО reveal (сервер уже отгейтил qtype и
  // наличие evidence.para). Стабильная ссылка → memo(QuestionBlock) держится; в mock/
  // listening проп undefined → пустое множество → кнопка нигде не рендерится.
  const locatableSet = useMemo(() => new Set(locatable ?? []), [locatable]);
  // «Where to look?» → тянет para ОДНОГО вопроса owner-path (тот же гейт, что reveal),
  // диспатчит существующий локатор (P2b-1 locatePara). true = para нашли; false → кнопку
  // тихо прячем (best-effort: сервер мог вернуть null на гонке/ошибке). Стабильна.
  const runLocate = useCallback(
    (n: number): Promise<boolean> =>
      locateEvidence(attemptId, n)
        .then((res) => {
          if (res?.para) {
            locatePara(res.para);
            return true;
          }
          return false;
        })
        .catch((e) => {
          console.error("locateEvidence call failed", e);
          reportClientError(e, "locateEvidence call failed");
          return false;
        }),
    [attemptId, locatePara],
  );

  const answered = Object.values(answers).filter(isAnswered).length;
  const remaining = durationSeconds != null ? Math.max(0, durationSeconds - elapsed) : null;

  const submit = () => {
    if (pending) return;
    startSubmit(() => submitAttempt(attemptId, answers));
  };

  // useCallback → стабильная ссылка onJump, чтобы memo(QuestionNavigator) не ломался
  // на каждый тик таймера (setCurrent/setPane/qScrollRef стабильны; jump зависит только
  // от scrollToQuestion, а у того deps пусты → ссылка jump тоже стабильна).
  // Скролл к вопросу с rAF-ретраем. offsetTop считать нельзя: у .exam-qscroll нет
  // position → offsetParent всплывал к body и scrollTo перелетал на высоту шапки.
  // Берём реальную дельту через rect. Ретрай нужен, т.к. на мобильном панель вопросов
  // могла быть display:none (активен таб Passage / deep-link на маунте) — тогда
  // clientHeight=0, rect нулевой и scrollTo прыгнул бы в 0. Ждём до ~60 кадров (~1с),
  // пока панель получит высоту после смены таба даже на медленном устройстве. Возвращаем
  // cancel: вызывающий может отменить rAF-цепочку (напр. при unmount deep-link эффекта).
  const scrollToQuestion = useCallback((n: number, smooth: boolean) => {
    let tries = 0;
    let rafId = 0;
    const attempt = () => {
      const el = document.getElementById(`q-${n}`);
      const wrap = qScrollRef.current;
      if (el && wrap && wrap.clientHeight > 0) {
        const top = wrap.scrollTop + el.getBoundingClientRect().top - wrap.getBoundingClientRect().top - 14;
        wrap.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
        return;
      }
      if (tries++ < 60) rafId = requestAnimationFrame(attempt);
    };
    rafId = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const jump = useCallback((n: number) => {
    setCurrent(n);
    setPane("questions"); // на мобильном гарантируем, что таб вопросов активен
    return scrollToQuestion(n, true);
  }, [scrollToQuestion]);

  // P15 — deep-link фокус: один раз на маунте проскроллить к вопросу (из mistakes/result).
  // Переиспользуем jump (setCurrent + на мобильном открывает панель вопросов + скролл в
  // qScrollRef через rect-дельту с rAF-ретраем). В mock focus===undefined → no-op,
  // mock-путь не затронут. didFocus гарантирует single-fire; cleanup отменяет rAF-цепочку.
  const didFocus = useRef(false);
  useEffect(() => {
    if (didFocus.current || focus == null) return;
    didFocus.current = true;
    // jump сам ждёт видимости панели вопросов (rAF-ретрай) — на мобильном дефолтный
    // таб Passage, и панель вопросов выходит из display:none только после setPane;
    // раньше одиночный rAF считал rect по скрытой панели (clientHeight=0) → scrollTop=0.
    return jump(focus); // cleanup отменяет rAF-цепочку, если ушли до появления панели
  }, [focus, jump]);

  // submitRef держит свежий submit (с актуальными answers) для авто-сабмита из таймера.
  useEffect(() => {
    submitRef.current = submit;
  });

  // Гидрация ТАЙМИНГА из localStorage (после mount — SSR не знает storage). Режим
  // задан сервером; storage хранит только wall-clock якоря. Совпадающая запись →
  // продолжаем отсчёт (refresh не сбрасывает Mock-дедлайн); нет записи или запись
  // от другого режима (смена режима между попытками) → старт с чистых якорей.
  useEffect(() => {
    // Listening MOCK — строгий single-pass: только audio-anchor, таймер ведёт запись.
    // Listening PRACTICE идёт по общему wall-clock пути ниже (счёт вверх с паузой, как reading).
    if (isListening && mode === "mock") {
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

  // Practice: счёт вверх, замирает на паузе (интервал гейтится paused). Работает и для
  // Listening practice (P8) — таймер отвязан от записи, как в reading-practice.
  useEffect(() => {
    if (!started || mode !== "practice" || paused) return;
    const t = setInterval(() => setPracticeSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [started, mode, paused]);

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

  // Listening single-pass (MOCK only): при возврате после refresh решаем фазу по реальному
  // времени. В practice запись разлочена (нет transfer/авто-сабмита), эффект не работает.
  useEffect(() => {
    if (!isListening || mode !== "mock" || audioDur <= 0 || resumeDecided.current) return;
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
  }, [isListening, mode, audioDur]);

  // Listening heartbeat (MOCK only): остаток записи / transfer, переход в transfer и
  // авто-сабмит по wall-clock. В practice не работает — запись под ручным управлением.
  useEffect(() => {
    if (!isListening || mode !== "mock") return;
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
  }, [isListening, mode, audioDur]);

  // В transfer звук останавливаем (на случай, если переход опередил событие ended).
  useEffect(() => {
    if (audioPhase === "transfer" && audioRef.current) audioRef.current.pause();
  }, [audioPhase]);

  // Старт/резюм записи (требует жеста — из gate-оверлея). Fresh: с 0 + якорь.
  // Resume: forward-seek к реальной позиции (реплея нет).
  const playAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    // P8 practice: аудио разлочено — старт с текущей позиции (0 при первом жесте), без
    // single-pass anchor/forward-seek. Дальше управление через AudioPlayer/ListeningLab.
    if (mode === "practice") {
      setAudioPhase("playing");
      void a.play().catch(() => setAudioPhase("gate"));
      return;
    }
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

  // P8 practice-контролы аудио (вызываются только из practice-ветки Listening Lab).
  const toggleAudioPractice = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };
  const seekAudio = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = Math.max(0, Math.min(sec, a.duration || sec));
    } catch {
      /* seek за пределы буфера мог не пройти — не критично */
    }
  };
  const replayAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
    } catch {
      /* seek до 0 мог не пройти — не критично */
    }
    void a.play().catch(() => {});
  };
  const setAudioSpeed = (r: number) => {
    const a = audioRef.current;
    if (a) a.playbackRate = r;
    setAudioRate(r);
  };

  const meta = `${categoryLabel(category)} · ${questions.length} questions`;

  // useMemo: partGroups зависит только от [questions, answers, flags] — тик таймера
  // их не меняет, поэтому memo(QuestionNavigator) ниже получает ту же ссылку и не
  // ре-рендерится 1/сек (на Listening — до ~4/сек из-за onTimeUpdate).
  const partGroups = useMemo(() => buildParts(questions, answers, flags), [questions, answers, flags]);

  // Таймер шапки: Listening — по записи (audio remaining → transfer); Reading после
  // гидрации/старта — по режиму; до гидрации Reading — прежнее поведение.
  let timerArea: React.ReactNode;
  // Practice-шапка расщепляется на два ряда, чтобы не разъезжаться на 3 строки на
  // телефоне: primary (clock + Submit — всегда видимы) и secondary (badge/pace/goal/
  // pause/restart — при нехватке ширины скроллятся горизонтально). Прочие режимы
  // (mock/transfer/pre-start) кладут всё в timerArea и рендерятся плоско, как раньше.
  let timerPrimary: React.ReactNode = null;
  let timerSecondary: React.ReactNode = null;
  // Listening MOCK — таймер по записи (single-pass). Listening PRACTICE использует общий
  // practice count-up ниже (счёт вверх с паузой/restart) — запись под ручным управлением.
  if (isListening && mode === "mock") {
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
      timerPrimary = (
        <span style={S.clock}>
          <Icon name={paused ? "pause" : "clock"} size={18} style={{ color: "var(--text-muted)" }} /> {fmt(practiceSeconds)}
        </span>
      );
      timerSecondary = (
        <>
          {/* Essential-бейдж режима — ПРЯМОЙ ребёнок .etr-secondary (не внутри
              .etr-scroll), чтобы флекс никогда не ужимал его контейнер уже своего
              контента: раньше badge жил в общем overflow-x:auto ряду и на узких
              телефонах обрезался серединой слова («PRACTIC|») без намёка на скролл. */}
          <span className="exam-mode-badge" style={badge(false)}>Practice</span>
          {/* Менее критичные practice-контролы — своя скроллящаяся полоса: при нехватке
              ширины уезжают вбок, не утягивая за собой essential-бейдж режима. */}
          <div className="etr-scroll">
            {/* Own-A — pacing coach: только Reading practice, при заданной длительности и
                включённом префе. Listening practice (свой transport P8) не трогаем. */}
            {!isListening && durationSeconds != null && questions.length > 0 && readerPrefs.pace && (
              <PacingChip targetSec={durationSeconds / questions.length} elapsedSec={practiceSeconds} answered={answered} />
            )}
            {/* P5 — микро-цель/брейки (practice-only). Общий и для reading, и для
                listening practice (обе ветки сюда попадают); mock не рендерит. */}
            <GoalControl answered={answered} total={questions.length} practiceSeconds={practiceSeconds} />
            <button type="button" onClick={togglePause} aria-label={paused ? "Resume timer" : "Pause timer"} title={paused ? "Resume" : "Pause"} className="exam-ctrl" style={S.ctrlBtn}>
              <Icon name={paused ? "play" : "pause"} size={16} />
            </button>
            <button type="button" onClick={restart} aria-label="Restart test" title="Restart test" className="exam-ctrl-text" style={S.ctrlBtnText}>
              Restart
            </button>
          </div>
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
          practice={isPractice}
          verdict={checked[String(q.number)]}
          reveal={revealed[String(q.number)]}
          checkBusy={!!checkBusy[String(q.number)]}
          wrongTry={wrongTries[String(q.number)] ?? 0}
          onCheck={runCheck}
          onReveal={runReveal}
          // Listening → undefined: панели пассажа нет, локатор не рендерится.
          onLocate={isListening ? undefined : locatePara}
          // P10 — метка уверенности (per-question); P2b-2 — локатор ДО reveal.
          confidence={confidence[String(q.number)]}
          onConfidence={setConf}
          canLocate={locatableSet.has(q.number)}
          onWhereToLook={isListening ? undefined : runLocate}
        />
      )),
    [questions, answers, flags, set, toggle, flag, isPractice, checked, revealed, checkBusy, wrongTries, runCheck, runReveal, isListening, locatePara, confidence, setConf, locatableSet, runLocate],
  );

  // Aa (reader settings, practice-reading-only) и Submit — общие для обеих веток
  // шапки (split practice / flat mock), выносим, чтобы не дублировать JSX.
  const readerBtn = readerActive ? (
    <button
      type="button"
      className="exam-ctrl"
      style={S.ctrlBtn}
      aria-label="Reading settings"
      aria-expanded={readerOpen}
      title="Reading settings"
      onClick={() => setReaderOpen((o) => !o)}
    >
      <span style={{ fontFamily: "var(--font-reading)", fontWeight: 800, fontSize: 15, lineHeight: 1 }}>Aa</span>
    </button>
  ) : null;
  const submitBtn = (
    <Button trailingIcon="arrow-right" onClick={submit} loading={pending}>
      Submit
    </Button>
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
        <div className="exam-top-right">
          {/* Practice: два nowrap-ряда (secondary скроллится, primary=clock+Submit
              всегда виден) → максимум 2 строки на телефоне. Прочие режимы — плоско. */}
          {timerSecondary ? (
            <>
              <div className="etr-secondary">
                {readerBtn}
                {timerSecondary}
              </div>
              <div className="etr-primary">
                {timerPrimary}
                {submitBtn}
              </div>
            </>
          ) : (
            <>
              {readerBtn}
              {timerArea}
              {submitBtn}
            </>
          )}
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
                    onEnded={() => {
                      // mock: конец записи → transfer-окно. practice: replay разрешён —
                      // просто гасим «играет», фаза остаётся playing (gate уже пройден).
                      if (mode === "mock") setAudioPhase("transfer");
                      else setAudioPlaying(false);
                    }}
                    onPlay={mode === "practice" ? () => setAudioPlaying(true) : undefined}
                    onPause={mode === "practice" ? () => setAudioPlaying(false) : undefined}
                    style={{ display: "none" }}
                  />
                  {audioPhase === "transfer" ? (
                    <div style={S.transferBanner}>
                      <Icon name="pencil-check" size={18} style={{ color: "var(--brand)" }} />
                      <span>Recording finished — use the transfer time to check and complete your answers.</span>
                    </div>
                  ) : (
                    <>
                      <AudioPlayer
                        progress={audioDur > 0 ? audioCur / audioDur : 0}
                        playing={mode === "practice" ? audioPlaying : audioPhase === "playing"}
                        totalSeconds={audioDur}
                        locked={mode !== "practice"}
                        onTogglePlay={mode === "practice" ? toggleAudioPractice : undefined}
                      />
                      {/* P8 practice: seek/replay/скорость. mock не рендерит (single-pass). */}
                      {mode === "practice" && audioDur > 0 && (
                        <ListeningLab
                          cur={audioCur}
                          dur={audioDur}
                          rate={audioRate}
                          onSeek={seekAudio}
                          onReplay={replayAudio}
                          onRate={setAudioSpeed}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div ref={qScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 24px 48px" }}>
              <div style={S.sheetHead}>
                <span style={S.sheetHint}>{mode === "practice" ? "Practice — pause, seek, or replay the recording as you work." : "Answer as you listen — the recording plays once."}</span>
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
              reader={readerFor}
              // P11 — жест «Save word» только в practice-чтении (стабильный boolean:
              // mode/isListening — серверные пропы, не меняются → memo(PassagePane) держится).
              canSaveWords={isPractice && !isListening}
            />

            {/* Questions pane (навигатор вынесен в нижнюю полосу) */}
            <div className="exam-pane exam-pane-q" style={S.qPane}>
              <div ref={qScrollRef} className="exam-qscroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
          practice={mode === "practice"}
          buffered={buffered}
          canPlay={canPlay}
          onPlay={playAudio}
        />
      )}

      {/* P4 — панель комфорта чтения (fixed, вне overflow shell). */}
      {readerActive && readerOpen && (
        <ReaderPanel prefs={readerPrefs} onChange={setReaderPrefs} onClose={() => setReaderOpen(false)} />
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
  fontWeight: 700,
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
  practice,
  verdict,
  reveal,
  checkBusy,
  wrongTry,
  onCheck,
  onReveal,
  onLocate,
  confidence,
  onConfidence,
  canLocate,
  onWhereToLook,
}: {
  q: Question;
  value: string | string[];
  flagged: boolean;
  onAnswer: (n: number, v: string) => void;
  onToggle: (n: number, letter: string) => void;
  onFlag: (n: number) => void;
  /** P6/P7 — practice-only обучающая петля. В mock всегда false → блок не рендерится. */
  practice: boolean;
  verdict: boolean | undefined;
  reveal: RevealResult | undefined;
  checkBusy: boolean;
  /** P14 — число неверных чеков этого вопроса. */
  wrongTry: number;
  onCheck: (n: number, v: string | string[]) => void;
  onReveal: (n: number) => void;
  /** P2b-1 — локатор абзаца (reading). undefined на listening. */
  onLocate?: (para: string) => void;
  /** P10 — метка уверенности этого вопроса (practice). undefined = не отмечено. */
  confidence?: ConfidenceLevel;
  onConfidence: (n: number, level: ConfidenceLevel) => void;
  /** P2b-2 — у вопроса есть локатор ДО reveal (сервер отгейтил qtype/наличие para). */
  canLocate: boolean;
  /** P2b-2 — запросить para ДО reveal (reading). undefined на listening. */
  onWhereToLook?: (n: number) => Promise<boolean>;
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
        <div className="exam-q-body" style={{ marginTop: 13 }}>
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
        {/* P1 — только practice: мягкая проверка формата (лимит слов / число выборов). */}
        {practice && <FormatHint q={q} value={value} />}
        {/* P2b — только practice: сворачиваемая стратегия по типу вопроса (zero-key). */}
        {practice && <StrategyHint qtype={q.qtype} />}
        {/* P2b-2 — локатор ДО reveal: reading (onWhereToLook задан), вопрос locatable,
            ещё не раскрыт. После reveal кнопка «Show in passage» живёт внутри
            PracticeCheck (P2b-1) → здесь гейтим !reveal, чтобы не дублировать. */}
        {practice && onWhereToLook && canLocate && !reveal && (
          <WhereToLook number={q.number} onWhereToLook={onWhereToLook} />
        )}
        {/* P6/P7/P14 — только practice: проверка ответа + вторая попытка + раскрытие ключа. */}
        {practice && (
          <PracticeCheck
            number={q.number}
            value={value}
            verdict={verdict}
            reveal={reveal}
            busy={checkBusy}
            wrongTry={wrongTry}
            onCheck={onCheck}
            onReveal={onReveal}
            onLocate={onLocate}
            confidence={confidence}
            onConfidence={onConfidence}
          />
        )}
      </div>
    </div>
  );
});

/**
 * FormatHint (P1) — практис-подсказка формата. Детерминированно (parseWordLimit /
 * parseChoiceCount по промпту) сигналит превышение лимита слов (completion) или числа
 * выборов (mcq_multi). Ключ НЕ трогается, ввод НЕ блокируется — только мягкий hint.
 * Возвращает null, когда формат не распознан или нарушения нет.
 */
const FormatHint = memo(function FormatHint({ q, value }: { q: Question; value: string | string[] }) {
  const hasOptions = !!q.options && q.options.length > 0;

  // mcq_multi: превышено число выборов из промпта («Choose TWO»).
  if (hasOptions && q.qtype === "mcq_multi") {
    const want = parseChoiceCount(q.prompt_html);
    const picked = Array.isArray(value) ? value.length : value ? 1 : 0;
    if (want != null && picked > want) {
      return <FormatHintText text={`Choose only ${want} — you've selected ${picked}.`} />;
    }
    return null;
  }

  // completion: превышен лимит слов (числовые токены не считаются при AND/OR A NUMBER).
  if (!hasOptions) {
    const limit = parseWordLimit(q.prompt_html);
    const single = Array.isArray(value) ? (value[0] ?? "") : value;
    if (limit != null && countWords(single, limit.allowNumber) > limit.maxWords) {
      return (
        <FormatHintText
          text={`Use no more than ${limit.maxWords} word${limit.maxWords === 1 ? "" : "s"}${limit.allowNumber ? " and/or a number" : ""}.`}
        />
      );
    }
  }
  return null;
});

function FormatHintText({ text }: { text: string }) {
  return (
    <div className="exam-fmt-hint" role="status">
      <Icon name="info" size={15} strokeWidth={2.4} />
      <span>{text}</span>
    </div>
  );
}

/**
 * PracticeCheck (P6/P7) — под каждым отвеченным вопросом в practice: «Check» → инлайн
 * вердикт ✓/✗; затем «Show answer & why» → правильный ответ + объяснение + evidence.
 * Всё через server actions под гейтами (owner/in_progress/practice); клиент получает
 * лишь boolean, а при раскрытии — accept/explanation/evidence ОДНОГО вопроса.
 */
const PracticeCheck = memo(function PracticeCheck({
  number,
  value,
  verdict,
  reveal,
  busy,
  wrongTry,
  onCheck,
  onReveal,
  onLocate,
  confidence,
  onConfidence,
}: {
  number: number;
  value: string | string[];
  verdict: boolean | undefined;
  reveal: RevealResult | undefined;
  busy: boolean;
  /** P14 — число неверных чеков этого вопроса. */
  wrongTry: number;
  onCheck: (n: number, v: string | string[]) => void;
  onReveal: (n: number) => void;
  /** P2b-1 — локатор абзаца (reading); undefined на listening → кнопка не рендерится. */
  onLocate?: (para: string) => void;
  /** P10 — метка уверенности этого вопроса (practice). undefined = не отмечено. */
  confidence?: ConfidenceLevel;
  onConfidence: (n: number, level: ConfidenceLevel) => void;
}) {
  // «Check» появляется только когда вопрос отвечён (непустой ответ).
  if (!isAnswered(value)) return null;
  const decided = verdict !== undefined;
  // P14: reveal-ссылка — сразу при верном ответе ИЛИ после второго неверного чека.
  const canReveal = verdict === true || wrongTry >= 2;
  const para = reveal?.evidence?.para;
  return (
    <div className="exam-check">
      {!decided ? (
        <button type="button" className="exam-check-btn" disabled={busy} onClick={() => onCheck(number, value)}>
          <Icon name="check" size={15} strokeWidth={2.6} /> Check
        </button>
      ) : (
        <>
          <span className={`exam-verdict ${verdict ? "ok" : "no"}`}>
            <Icon name={verdict ? "check" : "x"} size={16} strokeWidth={2.8} />
            {verdict ? "Correct" : wrongTry >= 2 ? "Not quite" : "Not quite — try once more"}
          </span>
          {/* P14: после первого неверного — «Check again» (тот же или изменённый ответ),
              чтобы не было тупика, если ученик уверен в ответе и не меняет его. */}
          {verdict === false && wrongTry < 2 && (
            <button type="button" className="exam-check-btn" disabled={busy} onClick={() => onCheck(number, value)}>
              <Icon name="check" size={15} strokeWidth={2.6} /> Check again
            </button>
          )}
          {canReveal && !reveal && (
            <button type="button" className="exam-reveal-link" disabled={busy} onClick={() => onReveal(number)}>
              Show answer &amp; why
            </button>
          )}
        </>
      )}
      {reveal && (
        <div className="exam-reveal" role="region" aria-label={`Answer for question ${number}`}>
          <div className="exam-reveal-label">Answer</div>
          <div className="exam-reveal-answer">{reveal.accept.join(" / ") || "—"}</div>
          {reveal.explanation && <p className="exam-reveal-why">{reveal.explanation}</p>}
          {reveal.explanationRu && <RuExplanation text={reveal.explanationRu} />}
          {reveal.evidence?.snippet && (
            <div className="exam-reveal-ev">
              <span aria-hidden="true">📖</span>
              <span>{reveal.evidence.snippet}</span>
            </div>
          )}
          {/* P2b-1: reading → интерактивный локатор; без onLocate (listening) — прежний текст. */}
          {para &&
            (onLocate ? (
              <button type="button" className="exam-locate-btn" onClick={() => onLocate(para)}>
                <Icon name="map-pin" size={14} strokeWidth={2.4} /> Show in passage
              </button>
            ) : (
              <div className="exam-reveal-ev-para">{para}</div>
            ))}
        </div>
      )}
      {/* P10 — метка уверенности (опциональна). Тот же answered-гейт, что у Check
          (PracticeCheck выше вернул null для неотвеченных). Своя строка (flex-basis:100%). */}
      <div className="exam-conf" role="group" aria-label={`How sure were you about question ${number}?`}>
        <span className="exam-conf-label">How sure?</span>
        {(["low", "med", "high"] as const).map((lvl) => (
          <button
            key={lvl}
            type="button"
            className="exam-conf-opt"
            data-level={lvl}
            aria-pressed={confidence === lvl}
            data-active={confidence === lvl ? "" : undefined}
            onClick={() => onConfidence(number, lvl)}
          >
            {lvl === "low" ? "Unsure" : lvl === "med" ? "Maybe" : "Sure"}
          </button>
        ))}
      </div>
    </div>
  );
});

/**
 * RuExplanation (L1-слой, 0050) — свёрнутый по умолчанию RU-перевод английского
 * explanation внутри reveal. Свёрнут намеренно: EN-объяснение остаётся основной
 * методикой (IELTS сдаётся на английском), RU — страховочный слой для тех, кому
 * не хватает языка. Тот же паттерн тумблера, что StrategyHint ниже.
 */
function RuExplanation({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="exam-reveal-ru">
      <button
        type="button"
        className="exam-reveal-ru-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="exam-reveal-ru-badge">RU</span>
        {open ? "Hide" : "Explain in Russian"}
      </button>
      {open && <p className="exam-reveal-ru-text">{text}</p>}
    </div>
  );
}

/**
 * StrategyHint (P2b) — сворачиваемая стратегия по типу вопроса. Zero-key: контент
 * зависит ТОЛЬКО от qtype (strategyHints). Свёрнут по умолчанию; стиль — рядом с
 * FormatHint. Нет буллетов (неизвестный тип) → ничего не рендерим.
 */
const StrategyHint = memo(function StrategyHint({ qtype }: { qtype: string }) {
  const [open, setOpen] = useState(false);
  const bullets = strategyHints(qtype);
  if (bullets.length === 0) return null;
  return (
    <div className="exam-strategy">
      <button type="button" className="exam-strategy-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="lightbulb" size={15} strokeWidth={2.4} />
        <span>Strategy</span>
        <Icon name="chevron-down" size={15} strokeWidth={2.4} className="exam-strategy-chevron" data-open={open ? "" : undefined} />
      </button>
      {open && (
        <ul className="exam-strategy-list">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

/**
 * PacingChip (Own-A) — ненавязчивый темп-коуч у practice count-up (только Reading).
 * Целевой темп = durationSeconds / кол-во вопросов; статус — по дрейфу elapsed от
 * answered × target. Без алармизма: «Behind» = warn (не error); до первого ответа
 * статус нейтральный (на этапе чтения пассажа «behind» было бы ложной тревогой).
 * Чисто клиентский, ключа/грейдинга не касается.
 */
function PacingChip({ targetSec, elapsedSec, answered }: { targetSec: number; elapsedSec: number; answered: number }) {
  const perMin = Math.round((targetSec / 60) * 10) / 10;
  const target = targetSec >= 60 ? `≈${perMin} min/Q` : `≈${Math.round(targetSec)}s/Q`;
  const drift = elapsedSec - answered * targetSec; // >0 — идём медленнее бюджета
  let status: "ahead" | "on" | "behind" = "on";
  if (answered > 0) {
    if (drift > targetSec) status = "behind";
    else if (drift < -targetSec) status = "ahead";
  }
  const label = status === "ahead" ? "Ahead" : status === "behind" ? "Behind" : "On pace";
  return (
    <span className="exam-pace" data-status={status} title={`Target pace ${target} · ${label}`}>
      <span className="exam-pace-dot" aria-hidden="true" />
      <span className="exam-pace-target">{target}</span>
      <span className="exam-pace-status">{label}</span>
    </span>
  );
}

/**
 * WhereToLook (P2b-2) — практис-кнопка «Where to look?» ДО reveal (reading). Тянет
 * para одного вопроса owner-path (тот же гейт, что reveal) и подсвечивает абзац в
 * пассаже (переиспользует локатор P2b-1). Сервер вернул null (гонка/ошибка/qtype-
 * гейт) → кнопку тихо прячем. Локальные hidden/busy живут в детях, чтобы пережить
 * ре-рендеры memo(QuestionBlock).
 */
const WhereToLook = memo(function WhereToLook({
  number,
  onWhereToLook,
}: {
  number: number;
  onWhereToLook: (n: number) => Promise<boolean>;
}) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (hidden) return null;
  return (
    <div className="exam-wtl">
      <button
        type="button"
        className="exam-locate-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onWhereToLook(number)
            .then((ok) => {
              if (!ok) setHidden(true);
            })
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="search" size={14} strokeWidth={2.4} /> Where to look?
      </button>
    </div>
  );
});

/**
 * GoalControl (P5) — практис-цель сессии + брейк-ремайндер (локальная форма).
 * Чип answered/goal у таймера + поповер настроек (цель 5/10/20/All, брейк 15/25м).
 * Цель достигнута → ненавязчивое поздравление; брейк каждые X минут → мягкий ремайндер
 * (оба через reduced-motion-aware тост). Prefs глобальные в localStorage; без XP/
 * стриков/сервера. Рендерится ТОЛЬКО в practice-ветке таймера (mock не монтирует).
 */
function GoalControl({
  answered,
  total,
  practiceSeconds,
}: {
  answered: number;
  total: number;
  practiceSeconds: number;
}) {
  const [prefs, setPrefs] = useState<GoalPrefs>(GOAL_DEFAULT);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const celebrated = useRef(false);
  const breakAck = useRef(0);

  // Гидрация/персист префов — client-only (как reader-prefs), гейт hydrated не даёт
  // маунт-записи затереть storage до чтения.
  useEffect(() => {
    setPrefs(readGoalPrefs());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) writeGoalPrefs(prefs);
  }, [hydrated, prefs]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const goalCount = prefs.goal === "all" ? total : prefs.goal;
  const reached = goalCount != null && goalCount > 0 && answered >= goalCount;

  // Поздравление один раз на достижение; сбрасывается, если цель отодвинули/сменили.
  useEffect(() => {
    if (reached && !celebrated.current) {
      celebrated.current = true;
      showToast(prefs.breakMin != null ? "Goal reached — nice work. Time for a short break?" : "Goal reached — nice work!");
    } else if (!reached) {
      celebrated.current = false;
    }
  }, [reached, prefs.breakMin, showToast]);

  // Брейк-ремайндер каждые breakMin минут practice-времени (счётчик, не тик-в-тик).
  useEffect(() => {
    if (prefs.breakMin == null) return;
    const passed = Math.floor(practiceSeconds / (prefs.breakMin * 60));
    if (passed > breakAck.current && passed > 0) {
      breakAck.current = passed;
      showToast(`You've been at it ${passed * prefs.breakMin} min — a short break helps focus.`);
    }
  }, [practiceSeconds, prefs.breakMin, showToast]);

  const setGoal = (goal: GoalValue | null) => setPrefs((p) => ({ ...p, goal }));
  // Смена интервала: якорим ack на текущее время, чтобы не выстрелить ретро-ремайндерами.
  const setBreak = (breakMin: 15 | 25 | null) => {
    breakAck.current = breakMin != null ? Math.floor(practiceSeconds / (breakMin * 60)) : 0;
    setPrefs((p) => ({ ...p, breakMin }));
  };

  return (
    <>
      <button
        type="button"
        className="exam-goal-chip"
        data-reached={reached ? "" : undefined}
        aria-expanded={open}
        aria-label="Session goal"
        title="Session goal"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="target" size={15} strokeWidth={2.4} />
        <span className="exam-goal-count">{goalCount != null ? `${Math.min(answered, goalCount)}/${goalCount}` : "Goal"}</span>
      </button>
      {open && (
        <>
          <button type="button" className="exam-goal-backdrop" aria-label="Close session goal" onClick={() => setOpen(false)} />
          <div className="exam-goal-panel" role="dialog" aria-label="Session goal">
            <div className="exam-reader-row">
              <span className="exam-reader-label">Session goal</span>
              <div className="exam-reader-seg" role="group" aria-label="Session goal">
                <button type="button" className="exam-reader-opt" aria-pressed={prefs.goal == null} data-active={prefs.goal == null ? "" : undefined} onClick={() => setGoal(null)}>Off</button>
                {GOAL_CHOICES.map((g) => (
                  <button key={g} type="button" className="exam-reader-opt" aria-pressed={prefs.goal === g} data-active={prefs.goal === g ? "" : undefined} onClick={() => setGoal(g)}>{g}</button>
                ))}
                <button type="button" className="exam-reader-opt" aria-pressed={prefs.goal === "all"} data-active={prefs.goal === "all" ? "" : undefined} onClick={() => setGoal("all")}>All</button>
              </div>
            </div>
            <div className="exam-reader-row">
              <span className="exam-reader-label">Break reminder</span>
              <div className="exam-reader-seg" role="group" aria-label="Break reminder">
                <button type="button" className="exam-reader-opt" aria-pressed={prefs.breakMin == null} data-active={prefs.breakMin == null ? "" : undefined} onClick={() => setBreak(null)}>Off</button>
                {BREAK_CHOICES.map((b) => (
                  <button key={b} type="button" className="exam-reader-opt" aria-pressed={prefs.breakMin === b} data-active={prefs.breakMin === b ? "" : undefined} onClick={() => setBreak(b)}>{b}m</button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {toast && (
        <div className="exam-goal-toast" role="status" aria-live="polite">
          <Icon name="bell" size={15} strokeWidth={2.4} />
          <span className="exam-goal-toast-msg">{toast}</span>
          <button type="button" className="exam-goal-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="x" size={14} strokeWidth={2.6} />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * ListeningGate — оверлей старта/резюма записи Listening (single-pass). Показывает буфер
 * загрузки; Play активна когда хватает буфера. Resume-вариант — после refresh: продолжить
 * с реальной позиции (без реплея).
 */
function ListeningGate({
  resume,
  practice,
  buffered,
  canPlay,
  onPlay,
}: {
  resume: boolean;
  /** P8: practice-запись разлочена → честная копия «можно паузить/повторять». */
  practice?: boolean;
  buffered: number;
  canPlay: boolean;
  onPlay: () => void;
}) {
  const title = practice ? "Listening practice" : resume ? "Continue the recording" : "Listening test";
  const desc = practice
    ? "Practice mode — you can pause, seek, replay, and change the speed. Take your time."
    : resume
      ? "The recording kept playing while you were away. It resumes from the current point — no rewind or replay."
      : "The recording plays once. You can't pause, rewind, or replay it — answer as you listen.";
  return (
    <div className="exam-overlay" style={SS.overlay} role="dialog" aria-modal="true" aria-label="Listening recording">
      <div style={{ ...SS.panel, maxWidth: 460, textAlign: "center" }}>
        <span style={{ ...SS.cardIcon, width: 52, height: 52, margin: "0 auto 14px", background: "var(--brand-subtle)", color: "var(--brand)" }}>
          <Icon name="headphones" size={26} />
        </span>
        <h1 style={SS.startTitle}>{title}</h1>
        <p style={SS.startMeta}>{desc}</p>
        <div style={SS.bufferTrack} aria-hidden="true">
          <div style={{ ...SS.bufferFill, width: `${Math.round(buffered * 100)}%` }} />
        </div>
        <p style={SS.bufferLabel}>{canPlay ? "Audio ready" : `Loading audio… ${Math.round(buffered * 100)}%`}</p>
        <Button variant="primary" fullWidth disabled={!canPlay} trailingIcon="arrow-right" onClick={onPlay}>
          {resume && !practice ? "Resume" : "Play recording"}
        </Button>
      </div>
    </div>
  );
}

/**
 * ListeningLab (P8) — практис-контролы разлоченной записи: seek-полоса, replay и
 * скорость (0.75/1/1.25/1.5). Рендерится ТОЛЬКО в practice (mock — строгий single-pass).
 */
const LAB_RATES = [0.75, 1, 1.25, 1.5];
function ListeningLab({
  cur,
  dur,
  rate,
  onSeek,
  onReplay,
  onRate,
}: {
  cur: number;
  dur: number;
  rate: number;
  onSeek: (sec: number) => void;
  onReplay: () => void;
  onRate: (r: number) => void;
}) {
  return (
    <div className="lab">
      <input
        type="range"
        className="lab-seek"
        min={0}
        max={Math.max(1, Math.floor(dur))}
        step={1}
        value={Math.min(Math.floor(cur), Math.floor(dur))}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek recording"
      />
      <div className="lab-row">
        <button type="button" className="lab-btn" onClick={onReplay}>
          Replay
        </button>
        <span className="lab-sep" aria-hidden="true" />
        <span className="lab-label">Speed</span>
        {LAB_RATES.map((r) => (
          <button
            key={r}
            type="button"
            className="lab-rate"
            aria-pressed={rate === r}
            data-active={rate === r ? "" : undefined}
            onClick={() => onRate(r)}
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ReaderPanel (P4) — практис-панель комфорта чтения: размер шрифта (3 ступени),
 * межстрочный (2 ступени), тема пассажа (default/sepia). Fixed (вне overflow shell) +
 * backdrop закрывает по клику вне. Префы persist в ExamRunner (bando-reading-prefs).
 */
function ReaderPanel({
  prefs,
  onChange,
  onClose,
}: {
  prefs: ReaderPrefs;
  onChange: (p: ReaderPrefs) => void;
  onClose: () => void;
}) {
  // Escape закрывает панель (a11y-парность с клик-вне на backdrop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="exam-reader-backdrop" aria-label="Close reading settings" onClick={onClose} />
      <div className="exam-reader-panel" role="dialog" aria-label="Reading settings">
        <div className="exam-reader-row">
          <span className="exam-reader-label">Text size</span>
          <div className="exam-reader-seg" role="group" aria-label="Text size">
            {(["S", "M", "L"] as const).map((lbl, i) => (
              <button key={lbl} type="button" className="exam-reader-opt" aria-pressed={prefs.size === i} data-active={prefs.size === i ? "" : undefined} onClick={() => onChange({ ...prefs, size: i as 0 | 1 | 2 })}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="exam-reader-row">
          <span className="exam-reader-label">Line spacing</span>
          <div className="exam-reader-seg" role="group" aria-label="Line spacing">
            {(["Normal", "Loose"] as const).map((lbl, i) => (
              <button key={lbl} type="button" className="exam-reader-opt" aria-pressed={prefs.leading === i} data-active={prefs.leading === i ? "" : undefined} onClick={() => onChange({ ...prefs, leading: i as 0 | 1 })}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="exam-reader-row">
          <span className="exam-reader-label">Theme</span>
          <div className="exam-reader-seg" role="group" aria-label="Passage theme">
            {(["default", "sepia"] as const).map((t) => (
              <button key={t} type="button" className="exam-reader-opt" aria-pressed={prefs.theme === t} data-active={prefs.theme === t ? "" : undefined} onClick={() => onChange({ ...prefs, theme: t })}>
                {t === "default" ? "Default" : "Sepia"}
              </button>
            ))}
          </div>
        </div>
        {/* Own-A — вкл/выкл темп-коуч у practice-таймера. */}
        <div className="exam-reader-row">
          <span className="exam-reader-label">Pacing coach</span>
          <div className="exam-reader-seg" role="group" aria-label="Pacing coach">
            {([["On", true], ["Off", false]] as const).map(([lbl, val]) => (
              <button key={lbl} type="button" className="exam-reader-opt" aria-pressed={prefs.pace === val} data-active={prefs.pace === val ? "" : undefined} onClick={() => onChange({ ...prefs, pace: val })}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
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

/* --- P6/P7 practice check/reveal. Рендерится ТОЛЬКО в practice (mock не выводит
   блок вовсе → mock-раннер не затронут). Токены те же; брейкпоинт-свойства и тап-
   таргеты — в классах, не inline. --- */
.exam-check{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px;padding-left:39px}
.exam-check-btn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-check-btn:hover:not(:disabled){background:var(--surface-hover);color:var(--text-primary)}
.exam-check-btn:disabled{opacity:.55;cursor:default}
.exam-verdict{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700}
.exam-verdict.ok{color:var(--success-text)}
.exam-verdict.no{color:var(--error-text)}
.exam-reveal-link{display:inline-flex;align-items:center;background:none;border:none;padding:0;color:var(--brand);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.exam-reveal-link:hover:not(:disabled){color:var(--brand-hover)}
.exam-reveal-link:disabled{opacity:.55;cursor:default}
.exam-reveal{flex-basis:100%;margin-top:2px;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-hover);animation:exam-reveal-in .28s cubic-bezier(.16,1,.3,1) both}
.exam-reveal-label{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.exam-reveal-answer{margin-top:3px;font-family:var(--font-ui);font-size:var(--text-base);font-weight:700;color:var(--text-primary)}
.exam-reveal-why{margin:9px 0 0;font-family:var(--font-ui);font-size:var(--text-sm);line-height:1.6;color:var(--text-secondary)}
.exam-reveal-ev{display:flex;gap:7px;margin-top:9px;font-family:var(--font-ui);font-size:var(--text-sm);line-height:1.55;color:var(--text-secondary)}
.exam-reveal-ev-para{margin-top:6px;font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:700;color:var(--text-muted)}
/* RU-объяснение (L1-слой, 0050) — свёрнутый по умолчанию тумблер под EN-explanation. */
.exam-reveal-ru{margin-top:9px}
.exam-reveal-ru-toggle{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:2px 0;border:none;background:none;color:var(--text-muted);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-reveal-ru-toggle:hover{color:var(--text-secondary)}
.exam-reveal-ru-badge{font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:700;letter-spacing:.04em;color:var(--brand-active);background:var(--brand-subtle);border-radius:5px;padding:2px 5px}
.exam-reveal-ru-text{margin:6px 0 0;font-family:var(--font-ui);font-size:var(--text-sm);line-height:1.6;color:var(--text-secondary)}
@media (pointer:coarse){.exam-reveal-ru-toggle{min-height:44px}}
@keyframes exam-reveal-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.exam-reveal{animation:none}}
@media (pointer:coarse){.exam-check-btn{min-height:44px}.exam-reveal-link{min-height:44px}}

/* P1 format hint — мягкое предупреждение о формате (practice-only, ввод не блокирует). */
.exam-fmt-hint{display:flex;align-items:center;gap:7px;margin-top:9px;padding-left:39px;font-family:var(--font-ui);font-size:var(--text-sm);font-weight:600;color:var(--warn-text)}
.exam-fmt-hint svg{flex:none;color:var(--warn)}

/* P2b Strategy — сворачиваемая подсказка по типу вопроса (practice-only). Единый стиль
   с check/format-hint; отступ 39px = qNum(28)+gap(11). Тап-таргеты/reduced-motion в классах. */
.exam-strategy{margin-top:10px;padding-left:39px}
.exam-strategy-toggle{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:4px 2px 4px 0;border:none;background:none;color:var(--text-muted);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-strategy-toggle:hover{color:var(--text-secondary)}
.exam-strategy-chevron{transition:transform .18s ease}
.exam-strategy-chevron[data-open]{transform:rotate(180deg)}
.exam-strategy-list{list-style:disc;margin:8px 0 0;padding:0 0 0 57px;display:flex;flex-direction:column;gap:6px}
.exam-strategy-list li{font-family:var(--font-ui);font-size:var(--text-sm);line-height:1.55;color:var(--text-secondary)}
@media (prefers-reduced-motion:reduce){.exam-strategy-chevron{transition:none}}
@media (pointer:coarse){.exam-strategy-toggle{min-height:44px}}

/* P2b-1 locate — кнопка «Show in passage» внутри reveal (reading-practice only). */
.exam-locate-btn{display:inline-flex;align-items:center;gap:6px;margin-top:9px;height:32px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--brand);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-locate-btn:hover{background:var(--surface-hover)}
@media (pointer:coarse){.exam-locate-btn{min-height:44px}}

/* P2b-2 «Where to look?» ДО reveal — обёртка держит отступ 39px как check/strategy;
   кнопка переиспользует .exam-locate-btn (тап-таргет уже там). */
.exam-wtl{margin-top:10px;padding-left:39px}

/* P10 confidence — метка уверенности (practice-only), своя строка под check
   (flex-basis:100% внутри .exam-check). Токены; тап-таргеты в @media coarse. */
.exam-conf{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px}
.exam-conf-label{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.exam-conf-opt{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-conf-opt:hover{background:var(--surface-hover);color:var(--text-primary)}
.exam-conf-opt[data-active][data-level="low"]{background:var(--warn-subtle);border-color:var(--warn);color:var(--warn-text)}
.exam-conf-opt[data-active][data-level="med"]{background:var(--brand-subtle);border-color:var(--brand);color:var(--brand)}
.exam-conf-opt[data-active][data-level="high"]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
@media (pointer:coarse){.exam-conf-opt{min-height:44px}}

/* Own-A pacing chip — темп-коуч у practice count-up (reading). Subtle-токены, без алармизма:
   behind = warn (не error). Статичный (без анимаций). Не интерактивен → без тап-таргета. */
.exam-pace{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;white-space:nowrap;line-height:1}
.exam-pace-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--text-muted)}
.exam-pace-target{font-family:var(--font-mono);color:var(--text-secondary)}
.exam-pace-status{letter-spacing:.02em;color:var(--text-secondary)}
.exam-pace[data-status="ahead"] .exam-pace-dot{background:var(--success)}
.exam-pace[data-status="ahead"] .exam-pace-status{color:var(--success-text)}
.exam-pace[data-status="behind"] .exam-pace-dot{background:var(--warn)}
.exam-pace[data-status="behind"] .exam-pace-status{color:var(--warn-text)}
.exam-pace[data-status="on"] .exam-pace-dot{background:var(--brand)}

/* P8 Listening Lab — practice-only аудио-контролы (mock: single-pass, блок не рендерится). */
.lab{margin-top:12px}
.lab-seek{display:block;width:100%;height:6px;margin:0 0 12px;accent-color:var(--brand);cursor:pointer}
.lab-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.lab-btn{display:inline-flex;align-items:center;height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.lab-btn:hover{background:var(--surface-hover);color:var(--text-primary)}
.lab-sep{width:1px;height:20px;background:var(--border);margin:0 3px}
.lab-label{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.lab-rate{display:inline-flex;align-items:center;justify-content:center;min-width:46px;height:34px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-mono);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.lab-rate:hover{background:var(--surface-hover);color:var(--text-primary)}
.lab-rate[data-active]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
@media (pointer:coarse){.lab-btn{min-height:44px}.lab-rate{min-height:44px}.lab-seek{height:12px}}

/* P4 Reader comfort panel — практис-панель размера/интерлиньяжа/темы пассажа (fixed). */
.exam-reader-backdrop{position:fixed;inset:0;z-index:39;border:none;background:transparent;cursor:default;padding:0}
.exam-reader-panel{position:fixed;top:60px;right:12px;z-index:40;width:min(280px,calc(100vw - 24px));display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-lg);animation:exam-reveal-in .2s cubic-bezier(.16,1,.3,1) both}
.exam-reader-row{display:flex;flex-direction:column;gap:7px}
.exam-reader-label{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.exam-reader-seg{display:flex;gap:6px}
.exam-reader-opt{flex:1;min-height:38px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.exam-reader-opt:hover{background:var(--surface-hover);color:var(--text-primary)}
.exam-reader-opt[data-active]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
@media (min-width:1024px){.exam-reader-panel{top:64px}}
@media (prefers-reduced-motion:reduce){.exam-reader-panel{animation:none}}
@media (pointer:coarse){.exam-reader-opt{min-height:44px}}

/* P5 goal — чип цели у practice-таймера + поповер (контент переиспользует
   .exam-reader-row/-label/-seg/-opt) + reduced-motion-aware тост поздравления/брейка. */
.exam-goal-chip{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);cursor:pointer;transition:var(--transition-colors)}
.exam-goal-chip:hover{background:var(--surface-hover);color:var(--text-primary)}
.exam-goal-chip[data-reached]{border-color:var(--success);color:var(--success-text)}
.exam-goal-count{font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:700;letter-spacing:.02em}
.exam-goal-backdrop{position:fixed;inset:0;z-index:39;border:none;background:transparent;cursor:default;padding:0}
.exam-goal-panel{position:fixed;top:60px;right:12px;z-index:40;width:min(280px,calc(100vw - 24px));display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-lg);animation:exam-reveal-in .2s cubic-bezier(.16,1,.3,1) both}
.exam-goal-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:55;display:flex;align-items:center;gap:9px;max-width:min(440px,calc(100vw - 24px));padding:11px 12px 11px 15px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-lg);animation:exam-reveal-in .24s cubic-bezier(.16,1,.3,1) both}
.exam-goal-toast svg{flex:none;color:var(--brand)}
.exam-goal-toast-msg{font-family:var(--font-ui);font-size:var(--text-sm);font-weight:600;color:var(--text-primary);line-height:1.4}
.exam-goal-toast-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;background:transparent;border-radius:8px;color:var(--text-muted);cursor:pointer;transition:var(--transition-colors)}
.exam-goal-toast-x:hover{background:var(--surface-hover);color:var(--text-primary)}
@media (min-width:1024px){.exam-goal-panel{top:64px}}
@media (prefers-reduced-motion:reduce){.exam-goal-panel,.exam-goal-toast{animation:none}}
@media (pointer:coarse){.exam-goal-chip{min-height:44px}.exam-goal-toast-x{width:44px;height:44px}}
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
/* Тело ответа/подсказок вопроса: отступ 39px (qNum 28 + gap 11) выравнивает контент
   под промпт на десктопе; на телефоне он съедал ~11% ширины → зануляем ниже (≤640). */
.exam-q-body{padding-left:39px}
.exam-qscroll{padding:12px 20px 28px}
.exam-split[data-pane="passage"] .exam-pane-q{display:none}
.exam-split[data-pane="questions"] .exam-pane-p{display:none}
/* Правый кластер шапки: wrap-контейнер с двумя nowrap-детьми → максимум 2 ряда на
   любой ширине (practice-режим). secondary (badge/pace/goal/pause/restart) при
   нехватке ширины скроллится горизонтально; primary (clock+Submit) всегда виден,
   не сжимается. mock-режим кладёт всё плоско — при ≤3 элементах wrap не срабатывает. */
/* flex:1+min-width:0 (не margin-left:auto) — ОГРАНИЧИВАЕТ кластер доступной шириной,
   иначе он рос бы до контента, wrap не срабатывал, а max-width:100% у secondary упирался
   в безразмерного родителя → Submit клиппился overflow:hidden shell на телефоне. */
.exam-top-right{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:14px}
.exam-top-right .etr-secondary{display:flex;flex-wrap:nowrap;align-items:center;gap:14px;min-width:0;max-width:100%}
/* Только «лишние» practice-контролы (пейс/цель/pause/restart) скроллятся горизонтально —
   Aa и бейдж режима остаются прямыми детьми .etr-secondary (см. JSX) и никогда не
   попадают в overflow-клип: раньше вся секция была одним overflow-x:auto рядом со
   скрытым скроллбаром, и бейдж мог оказаться обрезан серединой слова у края контейнера. */
.exam-top-right .etr-scroll{display:flex;flex-wrap:nowrap;align-items:center;gap:14px;min-width:0;overflow-x:auto;padding-block:2px;scrollbar-width:none}
.exam-top-right .etr-scroll::-webkit-scrollbar{display:none}
.exam-top-right .etr-primary{display:flex;flex-wrap:nowrap;align-items:center;gap:14px;flex:none}
/* Мобильная шапка (≤640px): правый кластер уходит ОТДЕЛЬНЫМ рядом во всю ширину ПОД
   заголовок (title получает ряд 1 целиком) — иначе тулбар (Aa/badge/pace/goal/таймер/
   Submit) жмётся в угол рядом с тайтлом и всё выглядит тесно. nowrap+space-between:
   secondary скроллится слева, clock+Submit фиксированы справа. DOM-порядок не трогаем
   (order ломает focus-порядок — WCAG 2.4.3). */
@media (max-width:640px){
  .exam-top{flex-wrap:wrap;row-gap:10px}
  .exam-top>div:first-of-type{flex:1 1 auto;min-width:0}
  .exam-top-right{flex-basis:100%;flex-wrap:nowrap;justify-content:space-between}
  /* Мобильный: контент вопроса на всю ширину карточки (39px-отступ под номер убираем). */
  .exam-q-body,.exam-check,.exam-fmt-hint,.exam-strategy,.exam-wtl{padding-left:0}
  .exam-strategy-list{padding-left:22px}
  /* Вторичные practice-контролы (Aa/badge/pace/goal/pause/restart) собираем в один
     контейнер-тулбар с фоном/рамкой — вместо разрозненных элементов, «плавающих»
     рядом с clock+Submit. Скроллится внутри себя, clock+Submit фиксированы справа. */
  .exam-top-right .etr-secondary{gap:10px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-inset)}
  .exam-top-right .etr-scroll{gap:10px}
}
@media (min-width:1024px){
  .exam-top{padding:12px 20px;gap:14px}
  .exam-tabs{display:none}
  /* W2-7: панель пассажа капается по ширине читаемой колонки (article maxWidth:900
     в PassagePane.tsx) — иначе flex:1.15 растягивает фон панели шире текста и
     оставшееся пространство висит пустым проёмом перед разделителем. Излишек
     (если он есть на очень широких вьюпортах) уходит вправо за панель вопросов,
     а не между текстом и вопросами. */
  .exam-pane-p{flex:1.15;max-width:900px}
  .exam-pane-q{flex:none;width:460px}
  .exam-split[data-pane="passage"] .exam-pane-q,
  .exam-split[data-pane="questions"] .exam-pane-p{display:flex}
}

/* Тап-таргеты ≥44px — на факте touch-ввода, не только на узких телефонах:
   иначе планшеты/landscape-телефоны (431-1023px) остаются с мелкими целями. */
@media (pointer:coarse){
  .exam-tabs button{height:44px!important}
  .exam-exit{width:44px!important;height:44px!important}
  .exam-ctrl{width:44px!important;height:44px!important}
  .exam-ctrl-text{height:44px!important}
  .exam-opt{min-height:44px!important}
  .exam-gap-input{min-height:44px!important}
}
/* Мобильный проход (≤430px): правый кластер шапки переносится (иначе Submit клиппит
   overflow:hidden shell), оверлеи прижаты к верху и скроллятся при высокой панели.
   Планшет/десктоп (>430px) не затрагиваются. */
@media (max-width:430px){
  .exam-top-right,.exam-top-right .etr-secondary,.exam-top-right .etr-scroll,.exam-top-right .etr-primary{gap:8px!important}
  .exam-qscroll{padding-left:14px;padding-right:14px}
  /* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
  .exam-gap-input{min-width:80px!important;max-width:100%!important;font-size:16px!important}
  .exam-answer-input{font-size:16px!important}
  .exam-overlay{align-items:start!important}
  /* Бейдж режима (Practice/Mock/Transfer) — смысловой лейбл, поднимаем до 12px,
     паддинги чуть уже (чип сжимается, а не обрезается). */
  .exam-mode-badge{font-size:12px!important;padding:4px 8px!important}
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
  topTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
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
