"use client";
import type * as React from "react";
import { useState } from "react";
import { Icon, type IconName } from "../core/icons";

export interface Feature {
  icon?: IconName;
  tone?: "brand" | "success" | "warn" | "error" | "info";
  image?: string;
  imageAlt?: string;
  title: string;
  description: string;
  href?: string;
}

interface FeatureGridProps {
  features: Feature[];
  columns?: number;
  variant?: "plain" | "tactile";
  onSelect?: (feature: Feature) => void;
  style?: React.CSSProperties;
}

// Tone → icon color + tinted tile bg (only used for the icon fallback, no image).
function tile(tone: Feature["tone"]) {
  const c = {
    brand:   "var(--brand)",
    success: "var(--success-text)",
    warn:    "var(--warn-text)",
    error:   "var(--error-text)",
    info:    "var(--info)",
  }[tone as string] || "var(--brand)";
  return { color: c, bg: `color-mix(in oklab, ${c} 14%, var(--surface))` };
}

/**
 * FeatureCard — one cell: a media block (3D illustration if `image` is set,
 * else a tinted Lucide icon tile) beside a title + description, with an arrow
 * at the bottom that slides on hover. Renders as a link when `href` is set.
 *
 * `variant`:
 *   "plain"   — clean white card, hairline border, soft shadow (marketing look)
 *   "tactile" — bando's 2px border + solid bottom edge, lifts on hover
 */
function FeatureCard({ feature, variant, onSelect }: { feature: Feature; variant?: "plain" | "tactile"; onSelect?: (feature: Feature) => void }) {
  const [hover, setHover] = useState(false);
  const t = tile(feature.tone);
  const Tag = feature.href ? "a" : "div";
  const tactile = variant === "tactile";

  const base = {
    display: "flex",
    gap: 22,
    padding: "26px 28px 20px",
    background: "var(--surface)",
    borderRadius: "var(--radius-lg)",
    textDecoration: "none",
    color: "inherit",
    cursor: feature.href || onSelect ? "pointer" : "default",
  };
  const skin = tactile
    ? {
        border: "2px solid",
        borderColor: hover ? "var(--brand-border)" : "var(--border)",
        boxShadow: hover ? "var(--shadow-solid-lg)" : "var(--shadow-solid)",
        transform: hover ? "translateY(-3px)" : "translateY(0)",
        transition: "transform var(--duration-base) var(--ease-out), box-shadow var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)",
      }
    : {
        border: "1px solid",
        borderColor: hover ? "var(--border-strong)" : "var(--border)",
        boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        transition: "transform var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
      };

  return (
    <Tag
      href={feature.href || undefined}
      onClick={onSelect ? () => onSelect(feature) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...skin }}
    >
      {/* Media */}
      <div style={{ flex: "none" }}>
        {feature.image ? (
          <img src={feature.image} alt={feature.imageAlt || ""} width={72} height={72}
            style={{ display: "block", width: 72, height: 72, objectFit: "contain" }} />
        ) : (
          <span style={{ display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "var(--radius-md)", background: t.bg, color: t.color }}>
            <Icon name={feature.icon || "circle-check"} size={26} strokeWidth={2.2} />
          </span>
        )}
      </div>

      {/* Text + arrow */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <h3 style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", color: "var(--text-primary)", margin: "2px 0 8px" }}>
          {feature.title}
        </h3>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text-muted)", margin: 0, textWrap: "pretty" }}>
          {feature.description}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <Icon name="arrow-right" size={20} strokeWidth={2.2}
            style={{ color: hover ? "var(--text-secondary)" : "var(--text-disabled)", transform: hover ? "translateX(4px)" : "translateX(0)", transition: "transform var(--duration-base) var(--ease-out), color var(--duration-fast) var(--ease-standard)" }} />
        </div>
      </div>
    </Tag>
  );
}

/**
 * FeatureGrid — a responsive grid of feature cards (3D illustration or icon +
 * title + description + hover arrow). The marketing "what you get" block.
 * `variant="plain"` (default) is the clean white card; "tactile" uses bando's
 * solid-edge cards. `columns` sets the desktop column count.
 */
export function FeatureGrid({ features = [], columns = 2, variant = "plain", onSelect, style }: FeatureGridProps) {
  if (!features.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 20,
        ...style,
      }}
    >
      {features.map((f) => <FeatureCard key={f.title} feature={f} variant={variant} onSelect={onSelect} />)}
    </div>
  );
}
