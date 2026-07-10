"use client";
import type * as React from "react";
import Link from "next/link";
import { useInteractive, sx, RING } from "./util";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
  /** Если задан — кнопка рендерится как ссылка (next/link), сохраняя вид кнопки. */
  href?: string;
  style?: React.CSSProperties;
}

const SIZES = {
  sm: { height: 40, padding: "0 16px", font: "var(--text-sm)", radius: "var(--radius-sm)", gap: 7, icon: 16, depth: 3 },
  md: { height: 50, padding: "0 22px", font: "var(--text-md)", radius: "var(--radius-md)", gap: 9, icon: 18, depth: 4 },
  lg: { height: 58, padding: "0 28px", font: "var(--text-lg)", radius: "var(--radius-md)", gap: 10, icon: 20, depth: 5 },
};

// Each variant: surface bg, label color, the 3D bottom-edge color, and whether
// it carries an inset hairline border (secondary/ghost).
function variant(v: ButtonVariant): { bg: string; fg: string; edge: string; inset: string | null; hover: string } {
  switch (v) {
    case "secondary": return { bg: "var(--surface)", fg: "var(--text-primary)", edge: "var(--neutral-edge)", inset: "var(--border-strong)", hover: "var(--surface-hover)" };
    // Inverse: white surface + brand ink, for the 3D CTA sitting on a brand-filled
    // panel (the practice hero) where primary's violet would vanish into the bg.
    case "inverse":   return { bg: "var(--surface)", fg: "var(--brand)", edge: "color-mix(in oklab, black 18%, transparent)", inset: null, hover: "var(--surface-hover)" };
    case "ghost":     return { bg: "transparent", fg: "var(--text-secondary)", edge: "transparent", inset: null, hover: "var(--surface-hover)" };
    case "danger":    return { bg: "var(--error)", fg: "white", edge: "var(--error-edge)", inset: null, hover: "color-mix(in oklab, var(--error) 88%, white)" };
    case "success":   return { bg: "var(--success)", fg: "white", edge: "var(--success-edge)", inset: null, hover: "color-mix(in oklab, var(--success) 90%, white)" };
    case "primary":
    default:          return { bg: "var(--brand)", fg: "var(--text-on-brand)", edge: "var(--brand-edge)", inset: null, hover: "var(--brand-hover)" };
  }
}

/**
 * Button — the chunky 3D "push" button that is bando's signature affordance. A
 * solid colored bottom edge gives it depth; pressing translates it down onto the
 * edge. Variants primary/secondary/ghost/danger/success; sizes sm/md/lg.
 */
export function Button({
  children, variant: v = "primary", size = "md", icon, trailingIcon,
  loading = false, disabled = false, fullWidth = false, type = "button", href, style, ...rest
}: ButtonProps) {
  const s = SIZES[size] || SIZES.md;
  const cfg = variant(v);
  const { hover, focus, active, handlers } = useInteractive();
  const isOff = disabled || loading;
  const pressed = active && !isOff;

  // Compose the layered boxShadow: optional inset hairline + solid bottom edge.
  const edge = v === "ghost" ? 0 : s.depth;
  const insetShadow = cfg.inset ? `inset 0 0 0 1.5px ${cfg.inset}` : "";
  const edgeShadow = edge ? `0 ${pressed ? 0 : edge}px 0 0 ${cfg.edge}` : "";
  const layers = [insetShadow, edgeShadow].filter(Boolean);
  if (focus && !isOff) layers.push(RING);
  const boxShadow = layers.join(", ") || undefined;

  const composedStyle = sx({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: s.gap,
    height: s.height, minWidth: s.height, padding: s.padding, width: fullWidth ? "100%" : undefined,
    marginBottom: edge && !pressed ? edge : 0,
    fontFamily: "var(--font-ui)", fontSize: s.font, fontWeight: "var(--weight-extrabold)",
    letterSpacing: "0.01em", lineHeight: 1,
    whiteSpace: "nowrap",
    color: cfg.fg, background: hover && !isOff ? cfg.hover : cfg.bg,
    border: "none", borderRadius: s.radius, cursor: isOff ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, boxShadow,
    transform: pressed ? `translateY(${edge}px)` : "none",
    transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)",
    WebkitTapHighlightColor: "transparent",
  }, style);

  const content = (
    <>
      {loading ? <Spinner size={s.icon} /> : (icon && <Icon name={icon} size={s.icon} strokeWidth={2.5} />)}
      {children && <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{children}</span>}
      {!loading && trailingIcon && <Icon name={trailingIcon} size={s.icon} strokeWidth={2.5} />}
    </>
  );

  // С href кнопка — это ссылка (next/link): избегаем невалидной вложенности <a><button>
  // и двойной остановки фокуса. Рендерим как <button> только без href или когда выключена.
  if (href && !isOff) {
    return (
      <Link href={href} style={composedStyle} {...handlers} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={isOff}
      aria-busy={loading || undefined}
      style={composedStyle}
      {...handlers}
      {...rest}
    >
      {content}
    </button>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", border: "2.5px solid color-mix(in oklab, currentColor 30%, transparent)", borderTopColor: "currentColor", animation: "nine-spin 0.7s linear infinite", display: "inline-block" }}>
      <style>{`@keyframes nine-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[style*="nine-spin"]{animation-duration:1.6s!important}}`}</style>
    </span>
  );
}
