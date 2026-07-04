"use client";
import { useEffect, useRef, useTransition } from "react";
import { submitAttempt } from "../../reading/[id]/actions";

interface Props {
  attemptId: string;
  contentItemId: string;
}

export default function ExamFrame({ attemptId, contentItemId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const submitted = useRef(false);
  const [, start] = useTransition();

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
      if (data?.type !== "ielts-submit" || submitted.current) return;
      submitted.current = true;
      start(() => submitAttempt(attemptId, data.answers ?? {}));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [attemptId]);

  return (
    <>
      {/* 100dvh с фолбэком на 100vh: динамический вьюпорт учитывает адресную строку/панели
          мобильного браузера, чтобы раннер не уезжал под них (на десктопе идентично 100vh). */}
      <style>{".exam-frame{height:100vh;height:100dvh}"}</style>
      <iframe
        ref={iframeRef}
        src={`/app/exam/${contentItemId}/runner`}
        title="IELTS exam"
        sandbox="allow-scripts allow-modals"
        className="exam-frame"
        style={{ width: "100%", border: "0", display: "block" }}
      />
    </>
  );
}
