import type { CSSProperties } from "react";

/**
 * Базовая геометрия пилюли раздела Progress — общая для под-навигации
 * (ProgressTabs) и фильтров лидерборда (LeaderboardControls). Раньше объект был
 * скопирован в оба файла побайтово и молча разъезжался бы при правке одного.
 *
 * АКТИВНОЕ состояние сознательно НЕ здесь: у навигации и у фильтра оно разное.
 * Раздел метится solid-brand, фильтр — тихим brand-subtle. Пока оба несли solid,
 * три ряда одинаковых пилюль на League смешивали два уровня иерархии, и вопрос
 * «в каком я разделе» тонул среди «за какой период».
 */
export const PILL: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  fontWeight: 700,
  padding: "8px 15px",
  borderRadius: "var(--radius-full)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-secondary)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
