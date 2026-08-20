import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";
import { PILL } from "./pill";

interface Option {
  value: string;
  label: string;
}

/**
 * Период / охват лидерборда — bando-табы. URL-фильтрация остаётся серверной
 * (чипы это next/link на ?period=&scope=); клиентский роутер не нужен. Scope
 * получает иконку: globe для global, map-pin для региональных охватов.
 *
 * Активный чип метится ТИШЕ, чем активный таб раздела (ProgressTabs): фильтр —
 * второй уровень иерархии, и solid-brand на обоих давал до трёх рядов
 * неразличимых пилюль с двумя «активными» подряд.
 */
export default function LeaderboardControls({
  period,
  scope,
  periodOptions,
  scopeOptions,
}: {
  period: string;
  scope: string;
  periodOptions: Option[];
  scopeOptions: Option[];
}) {
  const href = (p: string, s: string) =>
    `/app/progress?tab=league&period=${encodeURIComponent(p)}&scope=${encodeURIComponent(s)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 4 }}>
      {/* Тап-таргет чипов 8px 15px (~32px) < 44px на touch — не только узкие телефоны. */}
      <style>{"@media (pointer:coarse){.lc-tab{min-height:44px}}"}</style>
      <div style={ROW}>
        {periodOptions.map((o) => (
          <Tab key={o.value} href={href(o.value, scope)} active={period === o.value} label={o.label} />
        ))}
      </div>
      {scopeOptions.length > 1 && (
        <div style={ROW}>
          {scopeOptions.map((o) => (
            <Tab
              key={o.value}
              href={href(period, o.value)}
              active={scope === o.value}
              label={o.label}
              icon={o.value === "global" ? "globe" : "map-pin"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tab({
  href,
  active,
  label,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  icon?: IconName;
}) {
  return (
    <Link href={href} className="lc-tab" aria-current={active ? "true" : undefined} style={{ ...PILL, ...(active ? TAB_ON : null) }}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.3} />}
      {label}
    </Link>
  );
}

const ROW: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 9 };
// --text-link на --brand-subtle = 5.75:1 (AA). Тихая заливка вместо solid-brand:
// «выбранный фильтр», а не «текущий раздел».
const TAB_ON: React.CSSProperties = {
  background: "var(--brand-subtle)",
  color: "var(--text-link)",
  borderColor: "var(--brand-border)",
};
