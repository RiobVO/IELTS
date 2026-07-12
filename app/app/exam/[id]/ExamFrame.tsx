"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { isNextRedirectError } from "@/lib/exam/is-redirect-error";
import { saveProgress, submitAttempt } from "../../reading/[id]/actions";

interface Props {
  attemptId: string;
  contentItemId: string;
  // Лимит mock (минуты) для авто-старта нативного mode-card раннера. null → раннер
  // возьмёт свой дефолт. Уходит в runner-route как ?min= (там та же валидация).
  mockMinutes?: number | null;
}

// F2: debounce парент-стороны периодического автосейва (ielts-progress). Мост в
// раннере (skin-runner.ts injectProgressBridge) уже сам не спамит (снапшот-сравнение
// + собственный debounce/interval) — этот таймер лишь сглаживает пачку сообщений,
// если несколько прилетело почти одновременно.
const PROGRESS_SAVE_DEBOUNCE_MS = 3000;

export default function ExamFrame({ attemptId, contentItemId, mockMinutes }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const submitted = useRef(false);
  // F2: последний известный снапшот ответов — источник и для дебаунс-сейва по
  // ielts-progress, и для Retry после проваленного submitAttempt (сабмит должен
  // повторяться с самыми свежими ответами, не с теми, что были на первой попытке).
  const lastAnswers = useRef<Record<string, string | string[]>>({});
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, start] = useTransition();
  const [submitError, setSubmitError] = useState(false);

  const doSubmit = useCallback(
    (answers: Record<string, string | string[]>) => {
      submitted.current = true;
      setSubmitError(false);
      start(async () => {
        try {
          await submitAttempt(attemptId, answers);
        } catch (e) {
          // Успешный сабмит завершается redirect() — Next доносит это как брошенную
          // NEXT_REDIRECT-ошибку и до клиентского вызова; пробрасываем её дальше,
          // иначе навигация на /result не произойдёт (см. is-redirect-error.ts).
          if (isNextRedirectError(e)) throw e;
          // Реальный провал (сеть/БД): не роняем iframe в error boundary — ответы
          // best-effort автосохранены мостом (F2) и гарантированно живут в
          // lastAnswers этой вкладки; даём юзеру заметный Retry вместо потери попытки.
          submitted.current = false;
          setSubmitError(true);
        }
      });
    },
    [attemptId, start],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Раннер изолирован в opaque origin (sandbox без allow-same-origin): e.origin === "null"
      // и "null"===... никого не доказывает. Доверяем СТРОГО по идентичности окна — сообщение
      // должно прийти ровно из нашего iframe. null-guard: пока iframe не смонтирован / без
      // contentWindow — отвергаем, чтобы постороннее окно с e.source=null не совпало.
      const frame = iframeRef.current;
      if (!frame || !e.source || e.source !== frame.contentWindow) return;
      const data = e.data as {
        type?: string;
        answers?: Record<string, string | string[]>;
      };
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

  return (
    <>
      {/* 100dvh с фолбэком на 100vh: динамический вьюпорт учитывает адресную строку/панели
          мобильного браузера, чтобы раннер не уезжал под них (на десктопе идентично 100vh). */}
      <style>{".exam-frame{height:100vh;height:100dvh}.exam-frame-error{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:12px;max-width:min(480px,calc(100vw - 24px));padding:14px 16px;border-radius:var(--radius-lg);border:1px solid var(--error-edge);background:var(--surface);box-shadow:var(--shadow-lg)}.exam-frame-error-msg{font-family:var(--font-ui);font-size:var(--text-sm);font-weight:600;color:var(--text-primary);line-height:1.4}"}</style>
      <iframe
        ref={iframeRef}
        src={`/app/exam/${contentItemId}/runner${
          mockMinutes != null ? `?min=${mockMinutes}` : ""
        }`}
        title="IELTS exam"
        sandbox="allow-scripts allow-modals"
        className="exam-frame"
        style={{ width: "100%", border: "0", display: "block" }}
      />
      {/* Копирайт честный (Codex #4): «answers are saved» мог врать — дебаунс/сейв
          мог не долететь; гарантированно ответы живут в lastAnswers этой вкладки. */}
      {submitError && (
        <div className="exam-frame-error" role="alert">
          <Icon name="info" size={18} style={{ color: "var(--error)", flex: "none" }} />
          <span className="exam-frame-error-msg">
            Submit failed — check your connection and retry. Your answers are kept in this tab.
          </span>
          <Button size="sm" variant="danger" onClick={() => doSubmit(lastAnswers.current)}>
            Retry
          </Button>
        </div>
      )}
    </>
  );
}
