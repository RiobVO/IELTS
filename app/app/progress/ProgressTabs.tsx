import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";

/**
 * Под-навигация раздела Progress — route-табы League / Badges. Это НЕ JS-tablist:
 * переключение таба меняет URL (`?tab=`), поэтому две next/link с `aria-current` на
 * активной — правильнее ARIA-tablist (сохраняет back/forward, deep-link, no-JS).
 * Пилюли по образцу `LeaderboardControls` (тот же TAB/TAB_ON, тап-таргет 44px на
 * touch). Рендерится внутри wrap каждой панели → наследует её gutter.
 */
export function ProgressTabs({ tab }: { tab: "league" | "badges" }) {
  return (
    <nav aria-label="Progress sections" className="pg-tabs" style={NAV}>
      <style>{"@media (pointer:coarse){.pg-tab{min-height:44px}}"}</style>
      <TabLink href="/app/progress?tab=league" active={tab === "league"} icon="crown" label="League" />
      <TabLink href="/app/progress?tab=badges" active={tab === "badges"} icon="award" label="Badges" />
    </nav>
  );
}

function TabLink({ href, active, icon, label }: { href: string; active: boolean; icon: IconName; label: string }) {
  return (
    <Link href={href} className="pg-tab" aria-current={active ? "page" : undefined} style={{ ...TAB, ...(active ? TAB_ON : null) }}>
      <Icon name={icon} size={15} strokeWidth={2.3} />
      {label}
    </Link>
  );
}

const NAV: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 18 };
const TAB: React.CSSProperties = {
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
const TAB_ON: React.CSSProperties = {
  background: "var(--brand)",
  color: "var(--text-on-brand)",
  borderColor: "transparent",
};
