"use client";
import * as React from "react";
import { sx, RING } from "./util";
import { Icon, type IconName } from "./icons";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "style" | "size"> {
  icon?: IconName;
  invalid?: boolean;
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  /** Optional node rendered after the input (e.g. a clear button). Non-breaking: omitted by default. */
  trailing?: React.ReactNode;
  style?: React.CSSProperties;
  wrapStyle?: React.CSSProperties;
}

export function Input({
  icon,
  invalid = false,
  loading = false,
  disabled = false,
  size = "md",
  trailing,
  style,
  wrapStyle,
  ...rest
}: InputProps) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? 36 : size === "lg" ? 50 : 42;

  if (loading) {
    return (
      <div style={sx({ height: h, borderRadius: "var(--radius-md)", background: "var(--surface-hover)", animation: "nine-pulse 1.4s var(--ease-in-out) infinite" }, wrapStyle)}>
        <style>{`@keyframes nine-pulse{0%,100%{opacity:1}50%{opacity:.5}}@media (prefers-reduced-motion:reduce){[style*="nine-pulse"]{animation:none!important}}`}</style>
      </div>
    );
  }

  const borderColor = invalid
    ? "var(--error)"
    : focus
      ? "var(--brand)"
      : "var(--border)";

  return (
    <div
      style={sx(
        {
          display: "flex",
          alignItems: "center",
          gap: 9,
          height: h,
          padding: "0 14px",
          background: disabled ? "var(--surface-inset)" : "var(--surface-raised)",
          border: `2px solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          transition: "var(--transition-colors)",
          boxShadow: focus ? RING : invalid ? "0 0 0 3px var(--error-subtle)" : undefined,
          opacity: disabled ? 0.55 : 1,
        },
        wrapStyle,
      )}
    >
      {icon && <Icon name={icon} size={17} style={{ color: "var(--text-muted)" }} />}
      <input
        disabled={disabled}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        style={sx(
          {
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-base)",
            boxShadow: "none",
          },
          style,
        )}
        {...rest}
      />
      {trailing}
    </div>
  );
}
