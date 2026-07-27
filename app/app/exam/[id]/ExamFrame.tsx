"use client";
import { useEffect, useRef, useTransition } from "react";
import { submitAttempt } from "../../reading/[id]/actions";

interface Props {
  attemptId: string;
  contentItemId: string;
}

export default function ExamFrame({ attemptId, contentItemId }: Props) {
  const submitted = useRef(false);
  const [, start] = useTransition();

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Принимаем только наш origin (iframe same-origin).
      if (e.origin !== window.location.origin) return;
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
    <iframe
      src={`/app/exam/${contentItemId}/runner`}
      title="IELTS exam"
      sandbox="allow-scripts allow-same-origin allow-modals"
      style={{ width: "100%", height: "100vh", border: "0", display: "block" }}
    />
  );
}
