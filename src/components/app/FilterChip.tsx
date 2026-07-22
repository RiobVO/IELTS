"use client";
import Link from "next/link";
import { useInteractive } from "@/components/core/util";

interface FilterChipProps {
  href: string;
  active: boolean;
  label: string;
  /** Опциональный счётчик (моноширинный, приглушённый). */
  count?: number;
  /** Компактный вариант (для группы типов вопросов). */
  subtle?: boolean;
}

/**
 * FilterChip — фильтр-чип каталога в виде ссылки (URL-фильтрация на сервере).
 * Визуально = bando Tag: выбранное состояние, hover, опциональный счётчик.
 */
export function FilterChip({ href, active, label, count, subtle = false }: FilterChipProps) {
  const { hover, handlers } = useInteractive();
  return (
    <Link
      href={href}
      aria-pressed={active}
      {...handlers}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: subtle ? 32 : 36,
        padding: subtle ? "0 13px" : "0 16px",
        borderRadius: "var(--radius-full)",
        border: `2px solid ${active ? "var(--brand)" : hover ? "var(--border-strong)" : "var(--border)"}`,
        background: active ? "var(--brand)" : hover ? "var(--surface-hover)" : "var(--surface)",
        color: active ? "var(--text-on-brand)" : "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        fontSize: subtle ? "var(--text-xs)" : "var(--text-sm)",
        fontWeight: "var(--weight-bold)",
        textDecoration: "none",
        transition: "var(--transition-colors)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {count != null && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", opacity: 0.75 }}>{count}</span>
      )}
    </Link>
  );
}
