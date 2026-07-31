import Link from "next/link";
import { BASIC_DAILY_LIMIT } from "@/lib/tiers";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";

/**
 * CatalogNotice — почему юзера отбросило в практику. `limit` = исчерпан дневной
 * лимит Basic (mono-счётчик + апселл в Premium); `throttled` = анти-чит velocity-кап
 * на сабмите. URL-driven (`?limit=1`/`?throttled=1`); крестик ведёт на чистый хаб.
 *
 * Раньше жил внутри legacy-каталога (_CatalogView). После сворачивания Reading/
 * Listening в /app/practice notice переехал сюда: exam-access (access.ts) и
 * submit-throttle (reading/[id]/actions.ts) редиректят на хаб и сохраняют
 * пояснение + конверсионный CTA. Без внешнего margin — вертикальный ритм задаёт
 * flex-gap контейнера хаба.
 */
export function CatalogNotice({
  kind,
  dismissHref,
}: {
  kind: "limit" | "throttled";
  dismissHref: string;
}) {
  const limit = kind === "limit";
  const accent = limit ? "var(--warn)" : "var(--info)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 14,
        padding: "15px 18px",
        background: `color-mix(in oklab, ${accent} 7%, var(--surface))`,
        border: `2px solid color-mix(in oklab, ${accent} 38%, var(--border))`,
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-solid)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          flex: "none",
          borderRadius: "var(--radius-md)",
          display: "grid",
          placeItems: "center",
          background: limit ? "var(--warn-subtle)" : "var(--info-subtle)",
          color: limit ? "var(--warn-text)" : "var(--info)",
        }}
      >
        <Icon name={limit ? "flame" : "clock"} size={20} strokeWidth={2.4} />
      </span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "var(--tracking-tight)" }}>
            {limit ? `That's your ${BASIC_DAILY_LIMIT} free tests for today` : "One test at a time"}
          </span>
          {limit && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--warn-text)", background: "var(--warn-subtle)", borderRadius: "var(--radius-full)", padding: "2px 9px" }}>
              {BASIC_DAILY_LIMIT}/{BASIC_DAILY_LIMIT} used
            </span>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
          {limit
            ? `Basic includes ${BASIC_DAILY_LIMIT} tests a day — your next one unlocks tomorrow. Go Premium for unlimited practice.`
            : "You're starting tests too quickly. Give it a minute, then try again."}
        </div>
      </div>
      {limit && (
        <Button href="/app/upgrade" size="sm" trailingIcon="arrow-right" style={{ flex: "none" }}>
          Go unlimited
        </Button>
      )}
      {/* На touch крестик-дисмисс растёт до 44×44 (комфортный тап); на mouse — 30×30. */}
      <style>{"@media (pointer:coarse){.cn-dismiss{width:44px!important;height:44px!important}}"}</style>
      <Link
        href={dismissHref}
        aria-label="Dismiss notice"
        className="cn-dismiss"
        style={{ flex: "none", display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "var(--radius-sm)", color: "var(--text-muted)", textDecoration: "none" }}
      >
        <Icon name="x" size={16} />
      </Link>
    </div>
  );
}
