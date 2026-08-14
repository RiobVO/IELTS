import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";

interface Option {
  value: string;
  label: string;
}

/**
 * Период / охват лидерборда — bando-табы. URL-фильтрация остаётся серверной
 * (чипы это next/link на ?period=&scope=); клиентский роутер не нужен. Scope
 * получает иконку: globe для global, map-pin для региональных охватов.
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
    <Link href={href} className="lc-tab" style={{ ...TAB, ...(active ? TAB_ON : null) }}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.3} />}
      {label}
    </Link>
  );
}

const ROW: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 9 };
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
