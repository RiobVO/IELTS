"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/core/icons";

interface Pin {
  id: string;
  x: number; // %
  y: number; // %
}
interface Feature {
  id: string;
  number: number | string;
  label: string;
}

interface MapLabellingProps {
  title?: string;
  pins?: Pin[];
  features?: Feature[];
  answers?: Record<string, string>; // { featureId: pinId }
  active?: string | null; // currently-selected feature id
  onSelectFeature?: (featureId: string) => void;
  onAssign?: (pinId: string) => void;
  style?: CSSProperties;
}

/**
 * MapLabelling — вопрос IELTS Listening «подпиши карту/план». Схематичный план с
 * буквенными пинами (A–F) и список объектов для расстановки. Контролируемый:
 * всё состояние в `answers`/`active`, без таймеров (screenshot-safe). Модель
 * взаимодействия — у родителя: выбрать объект → тапнуть позицию (один пин на
 * объект, один объект на пин; конфликт снять). Схема абстрактная (дивы), не рисунок.
 */
export function MapLabelling({
  title = "Riverside Park — plan",
  pins = [],
  features = [],
  answers = {},
  active = null,
  onSelectFeature,
  onAssign,
  style,
}: MapLabellingProps) {
  const pinFor = (fid: string) => answers[fid];
  const featureForPin = (pid: string) => features.find((f) => answers[f.id] === pid);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "var(--space-4)", ...style }}>
      {/* Schematic plan */}
      <div style={{ position: "relative", aspectRatio: "4 / 3", background: "var(--surface-inset)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "62%", height: "16%", background: "color-mix(in oklab, var(--info) 24%, var(--surface-inset))", borderTop: "2px solid color-mix(in oklab, var(--info) 40%, transparent)", borderBottom: "2px solid color-mix(in oklab, var(--info) 40%, transparent)" }} />
        <div style={{ position: "absolute", left: "26%", top: 0, bottom: 0, width: 8, background: "var(--surface)", opacity: 0.7 }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: "32%", height: 8, background: "var(--surface)", opacity: 0.7 }} />
        <div style={{ position: "absolute", left: "6%", top: "8%", width: "16%", height: "18%", borderRadius: 8, background: "color-mix(in oklab, var(--success) 18%, var(--surface-inset))" }} />
        <div style={{ position: "absolute", right: "8%", top: "10%", width: "20%", height: "22%", borderRadius: 8, background: "color-mix(in oklab, var(--warn) 16%, var(--surface-inset))" }} />
        <div style={{ position: "absolute", left: "30%", bottom: "6%", width: "22%", height: "18%", borderRadius: 8, background: "color-mix(in oklab, var(--brand) 14%, var(--surface-inset))" }} />
        <span style={{ position: "absolute", left: 10, bottom: 8, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--text-disabled)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)" }}>{title}</span>

        {pins.map((p) => {
          const f = featureForPin(p.id);
          const filled = !!f;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onAssign?.(p.id)}
              aria-label={`Position ${p.id}${f ? `, ${f.label}` : ""}`}
              style={{
                position: "absolute",
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: "translate(-50%,-50%)",
                width: 30,
                height: 30,
                borderRadius: "50%",
                cursor: "pointer",
                border: `2px solid ${filled ? "var(--brand)" : "var(--border-strong)"}`,
                background: filled ? "var(--brand)" : "var(--surface)",
                color: filled ? "var(--text-on-brand)" : "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-sm)",
                fontWeight: 700,
                boxShadow: "var(--shadow-sm)",
                transition: "var(--transition-colors)",
                display: "grid",
                placeItems: "center",
              }}
            >
              {p.id}
            </button>
          );
        })}
      </div>

      {/* Feature list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {features.map((f) => {
          const assigned = pinFor(f.id);
          const isActive = active === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelectFeature?.(f.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                border: `2px solid ${isActive ? "var(--brand)" : assigned ? "var(--brand-border)" : "var(--border)"}`,
                background: isActive ? "var(--brand-subtle)" : "var(--surface)",
                cursor: "pointer",
                transition: "var(--transition-colors)",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-muted)", flex: "none" }}>{f.number}</span>
              <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" }}>{f.label}</span>
              <span
                style={{
                  width: 26,
                  height: 26,
                  flex: "none",
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  background: assigned ? "var(--brand)" : "var(--surface-inset)",
                  color: assigned ? "var(--text-on-brand)" : "var(--text-disabled)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 700,
                  border: assigned ? "none" : "2px dashed var(--border)",
                }}
              >
                {assigned || "?"}
              </span>
            </button>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>
          <Icon name="filter" size={12} /> {active ? "Now tap a position on the map" : "Tap a feature, then tap its position"}
        </div>
      </div>
    </div>
  );
}
