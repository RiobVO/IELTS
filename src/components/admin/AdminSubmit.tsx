"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant, type ButtonSize } from "@/components/core/Button";
import type { IconName } from "@/components/core/icons";

/**
 * Кнопки сабмита для server-action форм админки. До них ни одна форма не показывала
 * pending: медленная HTML-загрузка + мгновенный редирект = риск двойного клика и
 * ноль обратной связи. useFormStatus читается внутри <form> (эталон — auth SubmitButton).
 */
interface SubmitProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** name/value — для форм с несколькими submit-кнопками (intent=publish|draft). */
  name?: string;
  value?: string;
}

/** Обычный submit: на pending блокируется и крутит спиннер. */
export function SubmitButton({ children, variant, size, icon, name, value }: SubmitProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} icon={icon} name={name} value={value} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * ConfirmButton — submit с нативным подтверждением для необратимых/«уходит студентам»
 * действий (Publish/Unpublish/Delete). При отмене отменяет сабмит; после подтверждения
 * показывает pending. Нативный confirm сознателен: owner-only инструмент, нулевая
 * зависимость, «инструмент исчезает в задаче».
 */
export function ConfirmButton({ message, children, variant, size, icon, name, value }: SubmitProps & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      icon={icon}
      name={name}
      value={value}
      loading={pending}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
