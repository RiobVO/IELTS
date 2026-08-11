"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/core/icons";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { buildParaphraseQuestion } from "@/lib/vocab/paraphrase";
import { answerCardAction, answerCompletionAction, reviewCardAction } from "../actions";

/**
 * ReviewSession — клиентское тело одной сессии повторов (`/app/vocabulary/[deckId]`).
 * Четыре режима: Flashcards (флип word→definition, grade Again/Good), Type the answer
 * (по definition ввести word), Paraphrase (V8: выбрать слово по синониму-промпту)
 * и Completion (V9: заполнить gap-sentence). Quiz-режимы судит сервер, Flashcards — self-graded. Локальная
 * очередь общая для всех режимов: "good"/correct убирает карту из сессии, "again"/
 * incorrect переставляет её в конец (SM-2 стейт и дневной лимит — авторитетно на
 * сервере, этот компонент только гонит очередь и шлёт результат через готовые
 * reviewCardAction/answerCardAction).
 *
 * Тип карточки продублирован локально (не импортирован из server-only queries.ts,
 * который нельзя тянуть в client-бандл) — по паттерну PracticeCatalog: клиентский
 * компонент объявляет свою форму пропсов, а серверная page.tsx передаёт данные,
 * структурно совместимые с ней.
 */

type Grade = "again" | "good" | "easy";
type Mode = "flashcards" | "type" | "paraphrase" | "completion";
type AnswerAction = typeof answerCardAction;

export interface ReviewCard {
  id: string;
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
  // Enrichment 0038 (nullable). accepted_answers сюда не добавлять: грейдинг только на сервере.
  synonyms: string[] | null;
  collocations: string[] | null;
  wordFamily: string[] | null;
  quizPrompt: string | null;
  /** Нет строки прогресса (добор новых) → показываем grade "easy" (C2). Сервер авторитетен по gate.isNew. */
  isNew: boolean;
}

interface ReviewSessionProps {
  cards: ReviewCard[];
  /** Всего карт к повтору в деке (может быть больше, чем длина cards — та ограничена лимитом батча). */
  dueCount: number;
  /** Остаток новых карт на сегодня (null = безлимит premium/ultra). */
  newRemainingToday: number | null;
  deckTitle: string;
  /** Rescue-вариант той же сессии: очередь уже начатых трудных слов без новых карт. */
  rescueSession?: boolean;
}

export function ReviewSession({ cards, dueCount, newRemainingToday, deckTitle, rescueSession = false }: ReviewSessionProps) {
  const [total] = useState(cards.length);
  const [queue, setQueue] = useState(cards);
  const [mode, setMode] = useState<Mode>("flashcards");
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(newRemainingToday);
  // Дневной кап мог быть уже исчерпан ДО открытия сессии (0 новых при заходе) —
  // тот же баннер тогда обслуживает и стартовое, и словленное в процессе состояние.
  const [dailyCapHit, setDailyCapHit] = useState(newRemainingToday === 0);
  const [errorHint, setErrorHint] = useState(false);
  const [transientMsg, setTransientMsg] = useState<string | null>(null);
  const [stats, setStats] = useState({ again: 0, good: 0 });
  const [ttsVoice, setTtsVoice] = useState<SpeechSynthesisVoice | null>(null);

  // Type-режим: ввод, краткий success-флеш перед авто-переходом, и reveal неверного
  // ответа (ждёт явного "Continue" — в отличие от correct, который уходит сам).
  const [typedValue, setTypedValue] = useState("");
  const [correctFlash, setCorrectFlash] = useState(false);
  const [wrongState, setWrongState] = useState<{ correctWord: string; typedWrong: string } | null>(null);
  const correctTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (correctTimeoutRef.current) clearTimeout(correctTimeoutRef.current); }, []);
  // Синхронный one-shot guard для "Continue": два клика до ре-рендера иначе дважды
  // инкрементят again и дважды двигают ту же (замкнутую) карту в хвост очереди,
  // теряя реальную следующую голову ([A,B,C] → [C,A,A] вместо [B,C,A]). Ref мутирует
  // немедленно (в отличие от state), поэтому второй клик в том же тике уже видит true.
  const continueConsumedRef = useRef(false);

  const current = queue[0] ?? null;
  const completed = total - queue.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const finished = total > 0 && queue.length === 0;
  const neverHadCards = total === 0;

  // Дополнительные сегменты показываем только если в ИСХОДНОЙ очереди (cards) есть
  // хотя бы одна подходящая карта. На проде enrichment/quiz_prompt пуст → сегменты
  // не всплывают, переключатель остаётся прежним (Flashcards | Type).
  const paraphraseAvailable = cards.some((c) => (c.synonyms?.length ?? 0) > 0);
  const completionAvailable = cards.some((c) => !!c.quizPrompt);
  // Детерминированный Paraphrase-вопрос текущей карты (чистый модуль). Пул дистракторов —
  // исходная очередь cards (стабильна, не сжимается по мере ответов). null → у карты нет
  // synonyms/пула: в paraphrase-режиме рендерим обычную флип-карту (graceful mixed queue).
  const paraphraseQuestion = useMemo(
    () => (mode === "paraphrase" && current ? buildParaphraseQuestion(current, cards) : null),
    [mode, current, cards],
  );

  const showAnswerRef = useRef<HTMLButtonElement>(null);

  // Голоса Web Speech API часто приезжают после первого render; кнопку показываем
  // только когда браузер реально отдал английский voice.
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      return;
    }

    const synth = window.speechSynthesis;
    const pickVoice = (): void => {
      const voices = synth.getVoices();
      const englishVoices = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang));
      const preferred =
        englishVoices.find((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith("en-gb")) ??
        englishVoices[0] ??
        null;
      setTtsVoice(preferred);
    };

    pickVoice();
    synth.addEventListener("voiceschanged", pickVoice);
    return () => {
      synth.removeEventListener("voiceschanged", pickVoice);
      synth.cancel();
    };
  }, []);

  // Фокус следует за состоянием, а не остаётся на скрытой (backface-hidden) грани или
  // на контроле прошлого режима: flashcards-фронт → "Show answer"; flashcards-бэк →
  // "Again"; type/completion без ответа → инпут; paraphrase без ответа → первая опция; после wrong
  // → "Continue" (correct не фокусируем ничего — короткий флеш без интерактива, следующая
  // карта получит фокус сама, когда current?.id сменится). WCAG 2.4.3 — фокус не теряется.
  useEffect(() => {
    if (!current) return;
    // Карта без режима-specific промпта фактически рендерится флип-картой
    // — ведём фокус как во flashcards.
    const paraphraseAsFlip = mode === "paraphrase" && !paraphraseQuestion;
    const completionAsFlip = mode === "completion" && !current.quizPrompt;
    if (mode === "flashcards" || paraphraseAsFlip || completionAsFlip) {
      if (flipped) document.getElementById("rs-again-btn")?.focus();
      else showAnswerRef.current?.focus();
    } else if (wrongState) {
      document.getElementById("rs-continue-btn")?.focus();
    } else if (!correctFlash) {
      // Неотвеченная quiz-карта: paraphrase → первая опция, type/completion → инпут.
      if (mode === "paraphrase") document.getElementById("rs-opt-0")?.focus();
      else document.getElementById("rs-type-input")?.focus();
    }
  }, [current?.id, current?.quizPrompt, flipped, mode, wrongState, correctFlash, paraphraseQuestion]);

  // Транзиентное сообщение (tier/not_found, correct/incorrect в type-режиме) угасает
  // само — тот же паттерн, что GoalBar (practice/_PracticeCatalog.tsx) использует для
  // "Saved"/"Error".
  useEffect(() => {
    if (!transientMsg) return;
    const id = setTimeout(() => setTransientMsg(null), 2600);
    return () => clearTimeout(id);
  }, [transientMsg]);

  // Переключение режима меняет рендер ТЕКУЩЕЙ (ещё НЕотвеченной) карты — сбрасывает
  // только её локальный view-стейт; очередь/статистику/remaining/daily-cap не трогает.
  // Блокируется во время pending (ответ в полёте мог бы прилететь в режим, который
  // его уже не рендерит) И пока карта уже в отвеченном type-состоянии (correctFlash/
  // wrongState) — сервер результат уже записал, а correct-таймер ещё сдвинет очередь;
  // переключение должно действовать только на неотвеченную карту.
  function switchMode(next: Mode) {
    if (next === mode || pending || correctFlash || wrongState) return;
    if (next === "paraphrase" && !paraphraseAvailable) return;
    if (next === "completion" && !completionAvailable) return;
    setMode(next);
    setFlipped(false);
    setTypedValue("");
    setCorrectFlash(false);
    setWrongState(null);
    setErrorHint(false);
  }

  function pronounce(word: string): void {
    if (
      !ttsVoice ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(word);
    utterance.voice = ttsVoice;
    utterance.lang = ttsVoice.lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function renderTtsButton(word: string, hidden: boolean): ReactNode {
    if (!ttsVoice) return null;
    return (
      <button
        type="button"
        className="rs-tts"
        aria-label={`Pronounce ${word}`}
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : 0}
        onClick={() => pronounce(word)}
        style={S.ttsBtn}
      >
        <Icon name="volume" size={17} strokeWidth={2.2} />
      </button>
    );
  }

  async function submitGrade(grade: Grade) {
    const card = current;
    if (!card || pending) return;
    setPending(true);
    setErrorHint(false);
    try {
      const result = await reviewCardAction(card.id, grade);
      if (result.ok) {
        // Rescue-сессия новых карт не содержит: сервер всё равно возвращает остаток
        // тира для НАЧАТЫХ карт — адаптировать его здесь значит показать посреди
        // rescue вводящий в заблуждение бейдж/баннер дневного лимита. Игнорируем.
        if (!rescueSession) {
          setRemaining(result.newRemainingToday);
          // Кап мог дойти до 0 именно ЭТИМ ответом (new-карта съела последний слот) —
          // тот же баннер, что сидируется на старте сессии, идемпотентно.
          if (result.newRemainingToday === 0) setDailyCapHit(true);
        }
        // Easy — успех «знал сразу»: в сессионной статистике учитываем как good (карта
        // покидает сессию так же); отдельного счётчика Easy в итоге нет.
        const statKey: "again" | "good" = grade === "again" ? "again" : "good";
        setStats((s) => ({ ...s, [statKey]: s[statKey] + 1 }));
        // "again" — в конец локальной очереди (interval 0, due немедленно, как задумано
        // SM-2 на сервере); "good"/"easy" — карта покидает сессию. Вернувшуюся карту
        // помечаем isNew:false → при повторной встрече Easy не предлагаем (сервер всё
        // равно даунгрейдит, но UI не должен врать).
        setQueue((q) => (grade === "again" ? [...q.slice(1), { ...card, isNew: false }] : q.slice(1)));
        setFlipped(false);
      } else if (result.reason === "daily_cap") {
        setDailyCapHit(true);
        setQueue((q) => q.slice(1));
        setFlipped(false);
      } else if (result.reason === "tier" || result.reason === "not_found") {
        setTransientMsg("That card is no longer available — moving on.");
        setQueue((q) => q.slice(1));
        setFlipped(false);
      } else {
        // "invalid" | "error" — карта остаётся на месте, юзер может повторить попытку.
        setErrorHint(true);
      }
    } finally {
      setPending(false);
    }
  }

  // Общий отправитель quiz-ответа: сервер — единственный судья, клиент шлёт только
  // выбранное/введённое слово. Различие режимов — в источнике answer и server action.
  async function sendAnswer(answer: string, answerAction: AnswerAction = answerCardAction) {
    const card = current;
    if (!card || pending || !answer) return;
    setPending(true);
    setErrorHint(false);
    try {
      const result = await answerAction(card.id, answer);
      if (result.ok) {
        // См. комментарий в submitGrade: в rescue-сессии остаток лимита не адаптируем.
        if (!rescueSession) {
          setRemaining(result.newRemainingToday);
          // Кап мог дойти до 0 именно ЭТИМ ответом (new-карта съела последний слот) —
          // тот же баннер, что сидируется на старте сессии, идемпотентно.
          if (result.newRemainingToday === 0) setDailyCapHit(true);
        }
        if (result.correct) {
          setTransientMsg("Correct!");
          setCorrectFlash(true);
          // Короткая пауза (не CSS-анимация — reduced-motion не задета) перед авто-
          // переходом, чтобы юзер успел увидеть success-фидбек до смены карты.
          correctTimeoutRef.current = setTimeout(() => {
            setStats((s) => ({ ...s, good: s.good + 1 }));
            setQueue((q) => q.slice(1));
            setCorrectFlash(false);
            setTypedValue("");
          }, 650);
        } else {
          setTransientMsg(`Not quite — the answer was "${result.correctWord}".`);
          // Новый reveal — guard "Continue" снова "не потреблено".
          continueConsumedRef.current = false;
          // typedWrong = выбранное/введённое слово (в paraphrase — текст опции).
          setWrongState({ correctWord: result.correctWord, typedWrong: answer });
        }
      } else if (result.reason === "daily_cap") {
        setDailyCapHit(true);
        setQueue((q) => q.slice(1));
        setTypedValue("");
      } else if (result.reason === "tier" || result.reason === "not_found") {
        setTransientMsg("That card is no longer available — moving on.");
        setQueue((q) => q.slice(1));
        setTypedValue("");
      } else {
        // "invalid" | "error" — карта остаётся на месте, юзер может повторить попытку.
        setErrorHint(true);
      }
    } finally {
      setPending(false);
    }
  }

  // Incorrect-reveal подтверждён юзером — только теперь карта уходит в хвост очереди
  // и считается в статистике (again). Сервер уже записал grade в момент ответа;
  // Continue — чисто клиентский шаг продолжения, второго вызова action не делает.
  // one-shot guard (continueConsumedRef) — см. комментарий у объявления рефа.
  function continueAfterWrong() {
    const card = current;
    if (!card || !wrongState || continueConsumedRef.current) return;
    continueConsumedRef.current = true;
    setStats((s) => ({ ...s, again: s.again + 1 }));
    // Карта возвращается в хвост уже НЕ новой (сервер записал прогресс) → isNew:false,
    // чтобы при повторной встрече в flashcards Easy не предлагался.
    setQueue((q) => [...q.slice(1), { ...card, isNew: false }]);
    setWrongState(null);
    setTypedValue("");
  }

  function renderCompletionSentence(prompt: string): ReactNode {
    const parts = prompt.split("___");
    return parts.map((part, index) => (
      <span key={`completion-part-${index}`}>
        {index > 0 && (
          <span aria-label="missing word" style={S.completionGap}>
            &nbsp;
          </span>
        )}
        {part}
      </span>
    ));
  }

  function renderInputQuizForm(
    face: ReactNode,
    label: string,
    answerAction: AnswerAction = answerCardAction,
    placeholder?: string,
  ): ReactNode {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendAnswer(typedValue.trim(), answerAction);
        }}
        style={S.typeForm}
      >
        {face}
        <label htmlFor="rs-type-input" style={S.typeLabel}>{label}</label>
        <Input
          id="rs-type-input"
          size="lg"
          value={typedValue}
          onChange={(e) => setTypedValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          placeholder={placeholder}
          aria-label={label}
        />
        <Button type="submit" size="lg" disabled={pending || typedValue.trim() === ""} fullWidth>
          Check
        </Button>
      </form>
    );
  }

  // Флип-карта (word→definition + enrichment + grade Again/Good). Вынесена в функцию,
  // потому что используется в обычном Flashcards и graceful fallback ветках quiz-режимов.
  function renderFlashcards() {
    if (!current) return null;
    const syn = current.synonyms ?? [];
    const coll = current.collocations ?? [];
    const wf = current.wordFamily ?? [];
    const hasEnrich = syn.length > 0 || coll.length > 0 || wf.length > 0;
    return (
      <>
        <div className={`rs-flip${flipped ? " is-flipped" : ""}`}>
          <div className="rs-flip-inner">
            <div className="rs-face rs-face-front" aria-hidden={flipped || undefined}>
              <div style={S.wordRow}>
                <div style={S.word}>{current.word}</div>
                {renderTtsButton(current.word, flipped)}
              </div>
              {current.ipa && <div style={S.ipa}>{current.ipa}</div>}
              {current.partOfSpeech && <span style={S.pos}>{current.partOfSpeech}</span>}
              {/* Флип-триггер — обычная кнопка: клик/тап/Enter/Space работают из
                  коробки, без выдуманных aria-pressed/aria-expanded. Уходит из
                  таб-порядка и из a11y-дерева, когда грань перевёрнута назад
                  (CSS backface-visibility её только визуально прячет). */}
              <button
                type="button"
                ref={showAnswerRef}
                onClick={() => setFlipped(true)}
                tabIndex={flipped ? -1 : 0}
                aria-hidden={flipped || undefined}
                style={S.flipBtn}
              >
                Show answer
              </button>
            </div>
            <div className="rs-face rs-face-back" aria-hidden={!flipped || undefined}>
              <div style={S.definition}>{current.definition}</div>
              {current.example && <p style={S.example}><em>{current.example}</em></p>}
              {current.translation && <div style={S.translation}>{current.translation}</div>}
              {/* Enrichment 0038 — рендерим ТОЛЬКО присутствующие ряды; нет ни одного →
                  блока нет, карточка выглядит как раньше. Длинный контент скроллится
                  внутри .rs-face (overflow-y:auto), флип не ломается. */}
              {hasEnrich && (
                <div style={S.enrich}>
                  {syn.length > 0 && (
                    <div style={S.enrichRow}>
                      <span style={S.enrichLab}>Synonyms</span>
                      {syn.map((s, i) => (
                        <span key={`syn-${i}`} style={{ ...S.chip, ...S.chipSyn }}>{s}</span>
                      ))}
                    </div>
                  )}
                  {coll.length > 0 && (
                    <div style={S.enrichRow}>
                      <span style={S.enrichLab}>Collocations</span>
                      {coll.map((c, i) => (
                        <span key={`coll-${i}`} style={S.chip}>{c}</span>
                      ))}
                    </div>
                  )}
                  {wf.length > 0 && (
                    <div style={S.enrichRow}>
                      <span style={S.enrichLab}>Word family</span>
                      {wf.map((w, i) => (
                        <span key={`wf-${i}`} style={S.chip}>{w}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {flipped && (
          <>
            <div style={S.actions}>
              <Button
                id="rs-again-btn"
                variant="secondary"
                size="lg"
                disabled={pending}
                onClick={() => submitGrade("again")}
                style={{ flex: 1 }}
              >
                Again
              </Button>
              <Button
                variant="success"
                size="lg"
                disabled={pending}
                onClick={() => submitGrade("good")}
                style={{ flex: 1 }}
              >
                Good
              </Button>
              {/* Easy (V14) — только для новой карты. Ghost-brand по референсу; NEW-бейдж
                  сиблингом в relative-обёртке, т.к. children Button клиппятся overflow:hidden. */}
              {current.isNew && (
                <div style={S.easyWrap}>
                  <Button
                    variant="ghost"
                    size="lg"
                    disabled={pending}
                    onClick={() => submitGrade("easy")}
                    style={S.easyBtn}
                  >
                    Easy
                  </Button>
                  <span aria-hidden={true} style={S.newDot}>NEW</span>
                </div>
              )}
            </div>
            {/* Hint показываем только когда кнопка Easy видна (новая карта). */}
            {current.isNew && (
              <p style={S.easyHint}>
                Easy — new cards only: skips the 1d/3d ladder with a one-week first interval.
              </p>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="rs-wrap" style={S.wrap}>
      <style>{CSS}</style>

      <div>
        <Link href="/app/vocabulary" style={S.back}>
          <Icon name="arrow-left" size={15} strokeWidth={2.4} /> Back to decks
        </Link>
        <h1 style={S.title}>{deckTitle}</h1>
        <div style={S.headStats}>
          {dueCount > 0 && (
            <span style={S.stat}>
              <Icon name="clock" size={13} strokeWidth={2.4} /> {dueCount} due
            </span>
          )}
          {rescueSession && (
            <span style={S.rescueStat}>
              <Icon name="shield-check" size={13} strokeWidth={2.4} /> Rescue session · hardest {total}
            </span>
          )}
          {remaining !== null && (
            <span style={S.stat}>
              <Icon name="zap" size={13} strokeWidth={2.4} /> {remaining} new left today
            </span>
          )}
        </div>
        {!neverHadCards && !finished && (
          <div style={S.modeRow} role="group" aria-label="Review mode">
            {/* disabled пока карта в отвеченном состоянии (pending/correctFlash/
                wrongState) — переключение действует только на неотвеченную карту,
                зеркалит guard внутри switchMode. */}
            <button
              type="button"
              aria-pressed={mode === "flashcards"}
              disabled={pending || correctFlash || !!wrongState}
              className="rs-seg"
              style={{ ...S.seg, ...(mode === "flashcards" ? S.segActive : null), ...(pending || correctFlash || wrongState ? S.segOff : null) }}
              onClick={() => switchMode("flashcards")}
            >
              Flashcards
            </button>
            <button
              type="button"
              aria-pressed={mode === "type"}
              disabled={pending || correctFlash || !!wrongState}
              className="rs-seg"
              style={{ ...S.seg, ...(mode === "type" ? S.segActive : null), ...(pending || correctFlash || wrongState ? S.segOff : null) }}
              onClick={() => switchMode("type")}
            >
              Type the answer
            </button>
            {/* Paraphrase — только когда в исходной очереди есть карты с synonyms. */}
            {paraphraseAvailable && (
              <button
                type="button"
                aria-pressed={mode === "paraphrase"}
                disabled={pending || correctFlash || !!wrongState}
                className="rs-seg"
                style={{ ...S.seg, ...(mode === "paraphrase" ? S.segActive : null), ...(pending || correctFlash || wrongState ? S.segOff : null) }}
                onClick={() => switchMode("paraphrase")}
              >
                Paraphrase
              </button>
            )}
            {/* Completion — только когда в исходной очереди есть карты с quizPrompt. */}
            {completionAvailable && (
              <button
                type="button"
                aria-pressed={mode === "completion"}
                disabled={pending || correctFlash || !!wrongState}
                className="rs-seg"
                style={{ ...S.seg, ...(mode === "completion" ? S.segActive : null), ...(pending || correctFlash || wrongState ? S.segOff : null) }}
                onClick={() => switchMode("completion")}
              >
                Completion
              </button>
            )}
          </div>
        )}
      </div>

      {!finished && !neverHadCards && (
        <div
          style={S.progressRow}
          role="progressbar"
          aria-label="Session progress"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuetext={`${completed} of ${total} reviewed`}
        >
          <span style={S.progressTrack}>
            <span style={{ ...S.progressFill, width: `${pct}%` }} />
          </span>
          <span style={S.progressLabel}>{completed} / {total}</span>
        </div>
      )}

      {/* Тихое SR-объявление — карта убрана из DOM (tier/not_found) или ответ уже
          известен (correct/incorrect в type-режиме) раньше, чем сменится визуал. */}
      <div aria-live="polite" style={S.srOnly}>{transientMsg}</div>

      {dailyCapHit && (
        <div style={S.capNotice}>
          <span style={S.capIcon}>
            <Icon name="lock" size={18} strokeWidth={2.4} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={S.capTitle}>Daily new-card limit reached</div>
            <div style={S.capBody}>
              You&apos;ve started all the new cards Basic allows today. Reviews of cards
              you&apos;ve already seen aren&apos;t capped — upgrade for unlimited new cards
              every day.
            </div>
          </div>
          <Button href="/app/upgrade" size="sm" trailingIcon="arrow-right" style={{ flex: "none" }}>
            Upgrade
          </Button>
        </div>
      )}

      {neverHadCards || finished ? (
        <div style={S.summary}>
          <span style={S.summaryIcon}>
            <Icon name="circle-check" size={30} strokeWidth={2} />
          </span>
          {neverHadCards ? (
            <>
              <h2 style={S.summaryTitle}>All caught up</h2>
              <p style={S.summaryBody}>
                No cards are due right now in {deckTitle}. Check back later, or come back
                tomorrow for new ones.
              </p>
            </>
          ) : (
            <>
              <h2 style={S.summaryTitle}>Session complete</h2>
              <p style={S.summaryBody}>
                You reviewed {stats.again + stats.good} {stats.again + stats.good === 1 ? "card" : "cards"} in {deckTitle}.
              </p>
              <div style={S.summaryStats}>
                <div style={S.summaryStat}>
                  <span style={S.summaryStatVal}>{stats.good}</span>
                  <span style={S.summaryStatLab}>Good</span>
                </div>
                <div style={S.summaryStat}>
                  <span style={S.summaryStatVal}>{stats.again}</span>
                  <span style={S.summaryStatLab}>Again</span>
                </div>
              </div>
            </>
          )}
          <div style={S.summaryActions}>
            <Button href="/app/vocabulary" variant="secondary">Back to decks</Button>
            <Button onClick={() => window.location.reload()}>Review again</Button>
          </div>
        </div>
      ) : (
        current && (
          <>
            {mode === "flashcards" ? (
              renderFlashcards()
            ) : correctFlash ? (
              <div className="rs-compact" style={S.correctBox}>
                <Icon name="circle-check" size={26} strokeWidth={2.2} style={{ color: "var(--success-text)" }} />
                <span style={S.correctWord}>{current.word}</span>
              </div>
            ) : wrongState ? (
              <div style={S.wrongBox}>
                <div style={S.wrongRow}>
                  <span style={S.wrongLabel}>You typed</span>
                  <span style={S.wrongTyped}>{wrongState.typedWrong}</span>
                </div>
                <div style={S.wrongRow}>
                  <span style={S.wrongLabel}>Correct</span>
                  <span style={S.wrongCorrect}>{wrongState.correctWord}</span>
                </div>
                <div style={S.wrongFull}>
                  <div style={S.wordRow}>
                    <div style={S.word}>{current.word}</div>
                    {renderTtsButton(current.word, false)}
                  </div>
                  <div style={S.definition}>{current.definition}</div>
                  {current.translation && <div style={S.translation}>{current.translation}</div>}
                  {current.ipa && <div style={S.ipa}>{current.ipa}</div>}
                </div>
                <Button id="rs-continue-btn" variant="secondary" size="lg" onClick={continueAfterWrong} fullWidth>
                  Continue
                </Button>
              </div>
            ) : mode === "paraphrase" ? (
              // Paraphrase Sprint: карта с synonyms → выбор слова по синониму-промпту;
              // карта БЕЗ synonyms/пула (paraphraseQuestion === null) → обычная флип-карта.
              paraphraseQuestion ? (
                <div className="rs-compact" style={S.paraFace}>
                  <span style={S.paraOverline}>Paraphrase Sprint</span>
                  <div style={S.paraPrompt}>
                    Which word matches <em style={S.paraSyn}>&ldquo;{paraphraseQuestion.synonym}&rdquo;</em>?
                  </div>
                  <div role="group" aria-label="Answer options" style={S.optGroup}>
                    {paraphraseQuestion.options.map((opt, i) => (
                      <button
                        key={opt}
                        id={i === 0 ? "rs-opt-0" : undefined}
                        type="button"
                        className="rs-opt"
                        disabled={pending}
                        onClick={() => sendAnswer(opt)}
                        style={S.optBtn}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                renderFlashcards()
              )
            ) : mode === "completion" ? (
              current.quizPrompt ? (
                renderInputQuizForm(
                  <div className="rs-compact" style={S.completionFace}>
                    <span style={S.completionOverline}>Completion trainer</span>
                    <div style={S.completionPrompt}>{renderCompletionSentence(current.quizPrompt)}</div>
                  </div>,
                  "Type the missing word",
                  answerCompletionAction,
                  "Type the missing word...",
                )
              ) : (
                renderFlashcards()
              )
            ) : (
              renderInputQuizForm(
                <div className="rs-compact" style={S.typeFace}>
                  <div style={S.definition}>{current.definition}</div>
                  {current.example && <p style={S.example}><em>{current.example}</em></p>}
                </div>,
                "Type the word",
              )
            )}

            {errorHint && (
              <div role="alert" style={S.errorHint}>
                Couldn&apos;t save that — check your connection and try again.
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

/* Флип — стандартный 3D-приём (perspective + preserve-3d + backface-visibility).
   Единственный transition — сам rotateY; глобальный @media(prefers-reduced-motion)
   в tokens/base.css уже гасит ЛЮБОЙ transition-duration до ~0, так что смена грани
   становится мгновенной без своего дублирующего media-query (мгновенная смена без
   3D-вращения — ровно то, что просит инвариант reduced-motion). rs-seg — тот же
   pill-паттерн, что Segmented в writing/_Catalog.tsx (компонент не экспортирован,
   стиль продублирован). rs-compact держит высоту type-режима на уровне флип-карты,
   чтобы смена режима/ответа не дёргала layout. justify-content:safe center — центрируем
   грань, но при переполнении (длинный enrichment) падаем на выравнивание к началу, чтобы
   контент скроллился целиком, а не обрезался сверху centered-overflow-багом флексбокса. */
const CSS = `
.rs-flip{perspective:1200px}
.rs-flip-inner{position:relative;min-height:230px;transform-style:preserve-3d;transition:transform var(--duration-deliberate) var(--ease-in-out)}
.rs-flip.is-flipped .rs-flip-inner{transform:rotateY(180deg)}
.rs-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;text-align:center;gap:10px;padding:26px 22px;border-radius:var(--radius-xl);border:2px solid var(--border);background:var(--surface);box-shadow:var(--shadow-solid);overflow-y:auto;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.rs-face-back{transform:rotateY(180deg)}
.rs-seg{min-height:40px;padding:0 16px;font-size:13px}
.rs-seg:hover{color:var(--text-primary)}
.rs-tts:hover{background:var(--surface)}
.rs-compact{min-height:230px}
.rs-opt:hover{border-color:var(--brand-border);background:var(--brand-subtle)}
.rs-opt:disabled{opacity:.55;cursor:not-allowed}
@media (min-width:768px){
  .rs-flip-inner{min-height:270px}
  .rs-compact{min-height:270px}
}
@media (pointer:coarse){
  .rs-seg{min-height:44px}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px", display: "flex", flexDirection: "column", gap: 18, fontFamily: "var(--font-ui)" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textDecoration: "none" },
  title: { margin: "10px 0 0", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  headStats: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 },
  stat: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 700 },
  rescueStat: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", background: "var(--error-subtle)", color: "var(--error-text)", fontSize: 12.5, fontWeight: 800 },

  // Mode toggle (Flashcards | Type the answer | Paraphrase | Completion). flexWrap —
  // статичная страховка от переполнения на узких экранах при доп. сегментах (не брейкпоинт).
  modeRow: { display: "inline-flex", padding: 4, gap: 4, marginTop: 12, background: "var(--surface-inset)", borderRadius: 11, flex: "none", flexWrap: "wrap" },
  seg: { appearance: "none", border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: "pointer", transition: "var(--transition-colors)" },
  segActive: { background: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-xs)" },
  segOff: { opacity: 0.5, cursor: "not-allowed" },

  progressRow: { display: "flex", alignItems: "center", gap: 12 },
  progressTrack: { position: "relative", flex: 1, display: "block", height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  progressFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  progressLabel: { flex: "none", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },

  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },

  capNotice: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, padding: "15px 18px", background: "color-mix(in oklab, var(--warn) 7%, var(--surface))", border: "2px solid color-mix(in oklab, var(--warn) 38%, var(--border))", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" },
  capIcon: { width: 42, height: 42, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: "var(--warn-subtle)", color: "var(--warn-text)" },
  capTitle: { fontSize: 15, fontWeight: 800, color: "var(--text-primary)" },
  capBody: { fontSize: 13, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 },

  wordRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" },
  word: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  ttsBtn: { width: 38, height: 38, borderRadius: "var(--radius-full)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", display: "grid", placeItems: "center", padding: 0, cursor: "pointer", transition: "var(--transition-colors)" },
  ipa: { fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" },
  pos: { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-link)", background: "var(--brand-subtle)", padding: "3px 10px", borderRadius: "var(--radius-full)" },
  flipBtn: { marginTop: 14, appearance: "none", cursor: "pointer", padding: "10px 20px", borderRadius: "var(--radius-md)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  definition: { fontSize: 17, lineHeight: 1.5, color: "var(--text-primary)", fontWeight: 600 },
  example: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)" },
  translation: { fontSize: 15, fontWeight: 700, color: "var(--text-link)" },

  // Enrichment (back-грань флип-карты): mono overline-метки + chips. Синонимы —
  // brand-subtle, коллокации/word-family — surface-inset; разделитель border-subtle сверху.
  enrich: { width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 4, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" },
  enrichRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  enrichLab: { flex: "none", fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-disabled)" },
  chip: { display: "inline-flex", padding: "4px 11px", borderRadius: "var(--radius-full)", background: "var(--surface-inset)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 700 },
  chipSyn: { background: "var(--brand-subtle)", color: "var(--text-link)" },

  actions: { display: "flex", gap: 12 },
  errorHint: { textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--error-text)" },

  // Easy (V14) — ghost-brand третий грейд для новых карт: brand-subtle фон, brand-border,
  // text-link (тот же паттерн, что flipBtn). NEW-бейдж — абсолютный сиблинг в relative-обёртке.
  easyWrap: { flex: 1, position: "relative", display: "flex" },
  easyBtn: { flex: 1, boxSizing: "border-box", background: "var(--brand-subtle)", color: "var(--text-link)", border: "2px solid var(--brand-border)" },
  newDot: { position: "absolute", top: -9, right: -6, background: "var(--brand)", color: "#fff", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: "var(--radius-full)", pointerEvents: "none" },
  easyHint: { textAlign: "center", marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" },

  // Type-the-answer mode
  typeForm: { display: "flex", flexDirection: "column", gap: 14 },
  typeFace: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 10, padding: "26px 22px", borderRadius: "var(--radius-xl)", border: "2px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)", overflowY: "auto" },
  typeLabel: { fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" },

  // Completion Trainer (V9): gap-sentence с визуальным пропуском, ответ проверяется сервером.
  completionFace: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "safe center", textAlign: "center", gap: 16, padding: "26px 22px", borderRadius: "var(--radius-xl)", border: "2px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)", overflowY: "auto" },
  completionOverline: { fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-link)" },
  completionPrompt: { fontSize: 18, lineHeight: 1.6, fontWeight: 650, color: "var(--text-primary)", maxWidth: "42ch" },
  completionGap: { display: "inline-block", minWidth: "5.5ch", margin: "0 5px", borderBottom: "3px solid var(--brand)", lineHeight: 1, verticalAlign: "baseline" },

  // Paraphrase Sprint (V8): overline-подпись, промпт-синоним и колонка опций-кнопок.
  paraFace: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "safe center", textAlign: "center", gap: 14, padding: "26px 22px", borderRadius: "var(--radius-xl)", border: "2px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)", overflowY: "auto" },
  paraOverline: { fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-link)" },
  paraPrompt: { fontSize: 17, lineHeight: 1.5, fontWeight: 600, color: "var(--text-primary)", maxWidth: "40ch" },
  paraSyn: { fontStyle: "normal", fontWeight: 800, color: "var(--text-link)" },
  optGroup: { display: "flex", flexDirection: "column", gap: 9, width: "100%", maxWidth: 400 },
  optBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 16px", borderRadius: "var(--radius-md)", border: "2px solid var(--border)", background: "var(--surface)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", cursor: "pointer", boxShadow: "var(--shadow-solid)", transition: "var(--transition-colors)" },

  correctBox: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: "var(--radius-xl)", border: "2px solid var(--success-subtle)", background: "var(--success-subtle)" },
  correctWord: { fontSize: 24, fontWeight: 800, color: "var(--success-text)" },

  wrongBox: { display: "flex", flexDirection: "column", gap: 14, padding: "22px 20px", borderRadius: "var(--radius-xl)", border: "2px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  wrongRow: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 15 },
  wrongLabel: { flex: "none", minWidth: "5.5em", fontWeight: 700, color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" },
  wrongTyped: { textDecoration: "line-through", color: "var(--text-disabled)" },
  wrongCorrect: { fontWeight: 800, color: "var(--success-text)" },
  wrongFull: { display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center", paddingTop: 14, borderTop: "1px solid var(--border-subtle)" },

  summary: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "40px 24px", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)" },
  summaryIcon: { display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--success-subtle)", color: "var(--success-text)", marginBottom: 4 },
  summaryTitle: { margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" },
  summaryBody: { margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "42ch" },
  summaryStats: { display: "flex", gap: 28, marginTop: 6 },
  summaryStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  summaryStatVal: { fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 800, color: "var(--text-primary)" },
  summaryStatLab: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" },
  summaryActions: { display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "center" },
};
