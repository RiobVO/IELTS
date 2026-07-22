"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { isNextRedirectError } from "@/lib/exam/is-redirect-error";
import type { ConfidenceLevel } from "@/lib/practice/confidence-calibration";
import { readConfidence, writeConfidence } from "@/lib/practice/confidence-store";
import { saveProgress, submitAttempt } from "./actions";

interface Props {
  attemptId: string;
  contentItemId: string;
  /** Число вопросов теста (listening = 40) — размер дока уверенности. */
  questionCount: number;
}

// Debounce парент-стороны периодического автосейва (ielts-progress) — как в ExamFrame:
// мост в раннере уже сам не спамит, этот таймер лишь сглаживает пачку сообщений.
const PROGRESS_SAVE_DEBOUNCE_MS = 3000;

// Скорости воспроизведения practice-дока (реальный экзамен идёт только на 1×).
const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

interface AudioState {
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Practice-поверхность listening-теста с runner_html: тот же sandboxed iframe, что и mock
 * («точь-в-точь экзамен»), плюс минимальный набор practice-функций СНАРУЖИ iframe —
 * аудио-док (перемотка/Replay/скорость/play-pause через postMessage-мост) и док
 * уверенности (Unsure/Maybe/Sure по вопросам, та же per-attempt localStorage-механика,
 * что у атомизированной практики). Сабмит/грейдинг — существующий practice-путь
 * (submitAttempt → /result), капы/попытка стартуются на странице (mode='practice').
 *
 * Мост: parent доверяет ТОЛЬКО сообщениям своего iframe (e.source === contentWindow);
 * команды наружу шлём в тот же contentWindow. Ключи/ответы в iframe не передаются.
 */
export default function ListeningPractice({ attemptId, contentItemId, questionCount }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const submitted = useRef(false);
  const lastAnswers = useRef<Record<string, string | string[]>>({});
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, start] = useTransition();
  const [submitError, setSubmitError] = useState(false);
  const [audio, setAudio] = useState<AudioState>({ time: 0, duration: 0, playing: false, rate: 1 });
  const [confidence, setConfidence] = useState<Record<string, ConfidenceLevel>>({});
  const [confHydrated, setConfHydrated] = useState(false);
  const [confOpen, setConfOpen] = useState(false);

  const doSubmit = useCallback(
    (answers: Record<string, string | string[]>) => {
      submitted.current = true;
      setSubmitError(false);
      start(async () => {
        try {
          await submitAttempt(attemptId, answers);
        } catch (e) {
          // Успешный сабмит завершается redirect() (Next бросает NEXT_REDIRECT) —
          // пробрасываем, иначе навигация на /result не произойдёт.
          if (isNextRedirectError(e)) throw e;
          // Реальный провал: не роняем iframe — ответы живут в lastAnswers этой вкладки,
          // даём заметный Retry (как в ExamFrame).
          submitted.current = false;
          setSubmitError(true);
        }
      });
    },
    [attemptId, start],
  );

  // Единый message-хендлер: сабмит/прогресс (как ExamFrame) + состояние аудио. Доверяем
  // СТРОГО по идентичности окна — сообщение должно прийти ровно из нашего iframe (opaque
  // origin → e.origin === "null" ничего не доказывает).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame || !e.source || e.source !== frame.contentWindow) return;
      const data = e.data as {
        type?: string;
        answers?: Record<string, string | string[]>;
        time?: number;
        duration?: number;
        playing?: boolean;
        rate?: number;
      };
      if (data?.type === "ielts-audio-state") {
        setAudio({
          time: typeof data.time === "number" ? data.time : 0,
          duration: typeof data.duration === "number" ? data.duration : 0,
          playing: !!data.playing,
          rate: typeof data.rate === "number" && data.rate > 0 ? data.rate : 1,
        });
        return;
      }
      if (data?.type === "ielts-progress") {
        if (!data.answers) return;
        lastAnswers.current = data.answers;
        clearTimeout(progressTimer.current);
        progressTimer.current = setTimeout(() => {
          void saveProgress(attemptId, lastAnswers.current);
        }, PROGRESS_SAVE_DEBOUNCE_MS);
        return;
      }
      if (data?.type !== "ielts-submit" || submitted.current) return;
      lastAnswers.current = data.answers ?? lastAnswers.current;
      doSubmit(lastAnswers.current);
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(progressTimer.current);
    };
  }, [attemptId, doSubmit]);

  // Команда аудио-мосту внутри iframe. Тот же contentWindow, targetOrigin '*' (opaque
  // origin); мост валидирует отправителя по e.source === window.parent.
  const sendAudioCmd = useCallback((action: string, value?: number) => {
    iframeRef.current?.contentWindow?.postMessage({ type: "ielts-audio-cmd", action, value }, "*");
  }, []);

  // P10 — метки уверенности: гидрация из localStorage на маунте; запись гейтится
  // confHydrated (иначе первый write эффекта затёр бы сохранённое пустой картой).
  useEffect(() => {
    setConfidence(readConfidence(attemptId));
    setConfHydrated(true);
  }, [attemptId]);
  useEffect(() => {
    if (!confHydrated) return;
    writeConfidence(attemptId, confidence);
  }, [attemptId, confidence, confHydrated]);
  const setConf = useCallback((n: number, level: ConfidenceLevel) => {
    setConfidence((c) => {
      const k = String(n);
      const next = { ...c };
      if (next[k] === level) delete next[k]; // тот же уровень снова → снять метку
      else next[k] = level;
      return next;
    });
  }, []);

  const hasDuration = audio.duration > 0;
  const questionNumbers = Array.from({ length: Math.max(0, questionCount) }, (_, i) => i + 1);

  return (
    <div className="lp-root">
      <style>{LP_STYLE}</style>
      <iframe
        ref={iframeRef}
        src={`/app/exam/${contentItemId}/runner`}
        title="IELTS listening practice"
        sandbox="allow-scripts allow-modals"
        className="lp-frame"
      />

      {confOpen && (
        <div className="lp-conf" role="group" aria-label="How sure were you about each question?">
          <div className="lp-conf-head">How sure were you? (optional)</div>
          <div className="lp-conf-grid">
            {questionNumbers.map((n) => (
              <div className="lp-conf-row" key={n}>
                <span className="lp-conf-num">Q{n}</span>
                {(["low", "med", "high"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className="lp-conf-opt"
                    data-level={lvl}
                    aria-pressed={confidence[String(n)] === lvl}
                    data-active={confidence[String(n)] === lvl ? "" : undefined}
                    onClick={() => setConf(n, lvl)}
                  >
                    {lvl === "low" ? "Unsure" : lvl === "med" ? "Maybe" : "Sure"}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="lp-dock">
        <button
          type="button"
          className="lp-icon-btn"
          aria-label={audio.playing ? "Pause audio" : "Play audio"}
          onClick={() => sendAudioCmd(audio.playing ? "pause" : "play")}
        >
          <Icon name={audio.playing ? "pause" : "play"} size={18} />
        </button>
        <button
          type="button"
          className="lp-text-btn"
          onClick={() => sendAudioCmd("replay")}
        >
          Replay
        </button>
        <span className="lp-time">{fmtTime(audio.time)}</span>
        <input
          type="range"
          className="lp-seek"
          min={0}
          max={hasDuration ? audio.duration : 0}
          step={0.5}
          value={hasDuration ? Math.min(audio.time, audio.duration) : 0}
          disabled={!hasDuration}
          aria-label="Seek audio"
          onChange={(e) => sendAudioCmd("seek", Number(e.target.value))}
        />
        <span className="lp-time">{hasDuration ? fmtTime(audio.duration) : "--:--"}</span>
        <div className="lp-speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className="lp-speed-opt"
              aria-pressed={Math.abs(audio.rate - s) < 0.01}
              data-active={Math.abs(audio.rate - s) < 0.01 ? "" : undefined}
              onClick={() => sendAudioCmd("rate", s)}
            >
              {s}&times;
            </button>
          ))}
        </div>
        <button
          type="button"
          className="lp-text-btn lp-conf-toggle"
          aria-pressed={confOpen}
          data-active={confOpen ? "" : undefined}
          onClick={() => setConfOpen((o) => !o)}
        >
          How sure?
        </button>
      </div>

      {submitError && (
        <div className="lp-error" role="alert">
          <Icon name="info" size={18} style={{ color: "var(--error)", flex: "none" }} />
          <span className="lp-error-msg">
            Submit failed — check your connection and retry. Your answers are kept in this tab.
          </span>
          <Button size="sm" variant="danger" onClick={() => doSubmit(lastAnswers.current)}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

// Инлайн-стили (как ExamFrame): поверхность самодостаточна, не завязана на CSS-контекст
// ExamRunner. 100dvh с фолбэком на 100vh — динамический вьюпорт мобильного браузера.
const LP_STYLE = `
.lp-root{display:flex;flex-direction:column;height:100vh;height:100dvh;background:var(--bg)}
.lp-frame{flex:1 1 auto;min-height:0;width:100%;border:0;display:block}
.lp-conf{flex:0 1 auto;max-height:45vh;overflow-y:auto;border-top:1px solid var(--border);background:var(--surface);padding:12px 16px}
.lp-conf-head{font-family:var(--font-ui);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px}
.lp-conf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.lp-conf-row{display:flex;align-items:center;gap:6px}
.lp-conf-num{flex:none;width:34px;font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;color:var(--text-secondary)}
.lp-conf-opt{flex:1;height:30px;padding:0 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.lp-conf-opt:hover{background:var(--surface-hover);color:var(--text-primary)}
.lp-conf-opt[data-active][data-level="low"]{background:var(--warn-subtle);border-color:var(--warn);color:var(--warn-text)}
.lp-conf-opt[data-active][data-level="med"]{background:var(--brand-subtle);border-color:var(--brand);color:var(--brand)}
.lp-conf-opt[data-active][data-level="high"]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
.lp-dock{flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--border);background:var(--surface)}
.lp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text-primary);cursor:pointer;transition:var(--transition-colors)}
.lp-icon-btn:hover{background:var(--surface-hover)}
.lp-text-btn{height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.lp-text-btn:hover{background:var(--surface-hover);color:var(--text-primary)}
.lp-text-btn[data-active]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
.lp-time{font-family:var(--font-mono,var(--font-ui));font-size:var(--text-xs);font-weight:600;color:var(--text-secondary);min-width:44px;text-align:center}
.lp-seek{flex:1 1 160px;min-width:120px;accent-color:var(--brand);cursor:pointer}
.lp-seek:disabled{cursor:default;opacity:.5}
.lp-speeds{display:inline-flex;gap:4px}
.lp-speed-opt{height:30px;padding:0 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;cursor:pointer;transition:var(--transition-colors)}
.lp-speed-opt:hover{background:var(--surface-hover);color:var(--text-primary)}
.lp-speed-opt[data-active]{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}
.lp-conf-toggle{margin-left:auto}
.lp-error{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:12px;max-width:min(480px,calc(100vw - 24px));padding:14px 16px;border-radius:var(--radius-lg);border:1px solid var(--error-edge);background:var(--surface);box-shadow:var(--shadow-lg)}
.lp-error-msg{font-family:var(--font-ui);font-size:var(--text-sm);font-weight:600;color:var(--text-primary);line-height:1.4}
@media (pointer:coarse){.lp-conf-opt,.lp-speed-opt{min-height:40px}.lp-text-btn{min-height:40px}}
`;
