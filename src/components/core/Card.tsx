"use client";
import type * as React from "react";
import { useInteractive, sx } from "./util";

type HtmlTag = keyof React.JSX.IntrinsicElements &
  keyof HTMLElementTagNameMap;

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  interactive?: boolean;
  padding?: string;
  as?: HtmlTag;
  elevated?: boolean;
  style?: React.CSSProperties;
}

export function Card({
  children, interactive = false, padding = "var(--space-5)",
  as: Tag = "div", elevated = false, style, ...rest
}: React.PropsWithChildren<CardProps>) {
  const { hover, handlers } = useInteractive();
  return (
    <Tag
      style={sx({
        display: "block", background: "var(--surface)", border: "2px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding, color: "inherit",
        boxShadow: elevated ? "var(--shadow-md)" : "var(--shadow-solid)",
        marginBottom: interactive ? 0 : undefined,
        transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)",
        ...(interactive ? {
          cursor: "pointer",
          borderColor: hover ? "var(--brand-border)" : "var(--border)",
          boxShadow: hover ? "var(--shadow-solid-lg)" : "var(--shadow-solid)",
          transform: hover ? "translateY(-2px)" : "none",
        } : {}),
      }, style)}
      {...(interactive ? handlers : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}
