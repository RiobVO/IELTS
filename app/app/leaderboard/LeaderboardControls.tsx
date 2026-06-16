import { FilterChip } from "@/components/app/FilterChip";

interface Option {
  value: string;
  label: string;
}

/**
 * Период / охват лидерборда. URL-фильтрация (server-side) — чипы-ссылки на
 * общем FilterChip; клиентский роутер больше не нужен.
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
    `/app/leaderboard?period=${encodeURIComponent(p)}&scope=${encodeURIComponent(s)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {periodOptions.map((o) => (
          <FilterChip key={o.value} href={href(o.value, scope)} active={period === o.value} label={o.label} />
        ))}
      </div>
      {scopeOptions.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {scopeOptions.map((o) => (
            <FilterChip key={o.value} href={href(period, o.value)} active={scope === o.value} label={o.label} subtle />
          ))}
        </div>
      )}
    </div>
  );
}
