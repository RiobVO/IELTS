import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";
import { PILL } from "./pill";

/**
 * Под-навигация раздела Progress — route-табы Overview / League / Badges. Это НЕ
 * JS-tablist: переключение таба меняет URL (`?tab=`), поэтому три next/link с
 * `aria-current` на активной — правильнее ARIA-tablist (сохраняет back/forward,
 * deep-link, no-JS). Геометрия пилюли — общий `PILL` (тап-таргет 44px на touch);
 * активная несёт solid-brand — это ВЕРХНИЙ уровень иерархии на странице, фильтры
 * лидерборда метятся тише. Рендерится внутри wrap каждой панели → наследует её
 * gutter.
 */
export function ProgressTabs({ tab }: { tab: "overview" | "league" | "badges" }) {
  return (
    <nav aria-label="Progress sections" className="pg-tabs" style={NAV}>
      <style>{"@media (pointer:coarse){.pg-tab{min-height:44px}}"}</style>
      <TabLink href="/app/progress?tab=overview" active={tab === "overview"} icon="bar-chart" label="Overview" />
      <TabLink href="/app/progress?tab=league" active={tab === "league"} icon="crown" label="League" />
      <TabLink href="/app/progress?tab=badges" active={tab === "badges"} icon="award" label="Badges" />
    </nav>
  );
}

function TabLink({ href, active, icon, label }: { href: string; active: boolean; icon: IconName; label: string }) {
  return (
    <Link href={href} className="pg-tab" aria-current={active ? "page" : undefined} style={{ ...PILL, ...(active ? TAB_ON : null) }}>
      <Icon name={icon} size={15} strokeWidth={2.3} />
      {label}
    </Link>
  );
}

const NAV: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 18 };
const TAB_ON: React.CSSProperties = {
  background: "var(--brand)",
  color: "var(--text-on-brand)",
  borderColor: "transparent",
};
