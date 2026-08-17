"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { updateExamDate } from "./actions";

/**
 * Inline editor for profile.exam_date, embedded in the dashboard countdown card
 * (app/app/page.tsx). `autoOpen` skips the "Edit" toggle — used when there's no
 * date set (or it already passed) and the form itself is the primary CTA rather
 * than a secondary edit action.
 *
 * No optimistic state: updateExamDate's revalidatePath("/app") re-renders the
 * server-computed countdown once the action resolves, same as the rest of the
 * dashboard's server-first data flow.
 */
export function ExamDateEditor({
  initialDate,
  autoOpen = false,
}: {
  initialDate: string | null;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [value, setValue] = useState(initialDate ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    startTransition(() => {
      updateExamDate(value)
        .then(() => setOpen(autoOpen))
        .catch(() => setError(true));
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={S.editBtn}>
        Edit
      </button>
    );
  }

  return (
    <form onSubmit={save} style={S.form}>
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        aria-label="Exam date"
        size="sm"
      />
      <Button type="submit" size="sm" loading={pending}>
        Save
      </Button>
      {!autoOpen && (
        <button
          type="button"
          onClick={() => {
            setValue(initialDate ?? "");
            setOpen(false);
          }}
          style={S.cancelBtn}
        >
          Cancel
        </button>
      )}
      {error && (
        <span role="status" style={S.error}>
          Couldn&apos;t save — try again
        </span>
      )}
    </form>
  );
}

const S: Record<string, React.CSSProperties> = {
  editBtn: { background: "transparent", border: "none", color: "var(--brand-active)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, cursor: "pointer", padding: "4px 0" },
  cancelBtn: { background: "transparent", border: "none", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer", padding: "4px 6px" },
  form: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 },
  error: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--error-text)", width: "100%" },
};
