"use client";

import { useTransition } from "react";
import { Icon } from "@/components/core/icons";
import { resolveMistake } from "./actions";

/**
 * «Mark learned» — вызывает owner-path экшен resolveMistake; на успехе revalidatePath
 * перерисовывает серверную страницу и карточка уходит из списка. user_id экшен берёт
 * из сессии, qtype — из question (клиентскому не доверяем): сюда передаём только
 * (contentItemId, questionNumber). Тач ≥44px.
 */
export function MarkLearnedButton({
  contentItemId,
  questionNumber,
}: {
  contentItemId: string;
  questionNumber: number;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => resolveMistake(contentItemId, questionNumber))}
      aria-label="Mark this question learned"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        minHeight: 44,
        padding: "0 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-strong)",
        background: "var(--surface-raised)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.6 : 1,
        transition: "var(--transition-colors)",
      }}
    >
      <Icon name="check" size={16} strokeWidth={2.4} />
      {pending ? "Saving…" : "Mark learned"}
    </button>
  );
}
