import type * as React from "react";

/**
 * Болванка-плейсхолдер для route-level loading.tsx. Пульсацию даёт класс
 * `.skeleton` из globals.css (keyframes нельзя инлайнить), размеры/радиус —
 * инлайн-токены, в стиле проекта. Презентационный, без состояния → серверный.
 */
export function Skeleton({
  w = "100%",
  h = 16,
  r,
  style,
}: {
  w?: number | string;
  h?: number | string;
  /** Переопределить border-radius (по умолчанию --radius-md из класса). */
  r?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className="skeleton"
      style={{ width: w, height: h, ...(r != null ? { borderRadius: r } : {}), ...style }}
    />
  );
}
