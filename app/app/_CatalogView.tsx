import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPublishedTests } from "@/lib/content/published";
import { effectiveTier, meetsTier, BASIC_DAILY_LIMIT, type Tier } from "@/lib/tiers";
import { categoryLabel, qtypeLabel } from "@/lib/labels";
import { AppShell } from "./_AppShell";
import { Button } from "@/components/core/Button";
import { Card } from "@/components/core/Card";
import { Badge } from "@/components/core/Badge";
import { Icon } from "@/components/core/icons";
import { FilterChip } from "@/components/app/FilterChip";

/**
 * Shared catalog for Reading and Listening (BRIEF §4.1 — filter by category and
 * question type). Both sections render the same UI; only the section, category
 * list and filter base path differ. Filtering stays URL-based (server-side); the
 * filter chips are links, not client multi-select. The exam route is
 * content-generic, so every card links to /app/reading/[id] regardless of section.
 */

type Breakdown = Record<string, { correct: number; total: number }> | null;
type Test = Awaited<ReturnType<typeof getPublishedTests>>[number];

const TIER_LABEL: Record<Tier, string> = {
  basic: "Basic",
  premium: "Premium",
  ultra: "Ultra",
};

export async function CatalogView({
  section,
  categories,
  title,
  sub,
  filterBase,
  sp,
}: {
  section: "reading" | "listening";
  categories: readonly string[];
  title: string;
  sub: string;
  filterBase: string;
  sp: { category?: string; q_type?: string; limit?: string; throttled?: string };
}) {
  await requireUser();
  const supabase = await createClient();

  // Профиль / попытки (для рекомендации) / published-список — параллельно.
  const [profile, attemptsRes, all] = await Promise.all([
    getProfile(),
    supabase.from("attempt").select("per_type_breakdown").eq("status", "submitted").limit(50),
    getPublishedTests(section),
  ]);
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";

  const tests = all.filter(
    (t) =>
      (!sp.category || t.category === sp.category) &&
      (!sp.q_type || t.question_types.includes(sp.q_type)),
  );

  const catCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const r of all) {
    catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
    for (const qt of r.question_types ?? []) {
      typeCounts[qt] = (typeCounts[qt] ?? 0) + 1;
    }
  }
  const availableTypes = Object.keys(typeCounts).sort();
  const totalCount = all.length;
  const activeCount = (sp.category ? 1 : 0) + (sp.q_type ? 1 : 0);

  // Weakest question types из реального per_type_breakdown (как на дашборде).
  const attempts = (attemptsRes.data ?? []) as unknown as { per_type_breakdown: Breakdown }[];
  const agg: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    const b = a.per_type_breakdown;
    if (!b) continue;
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0 };
      cur.correct += v.correct;
      cur.total += v.total;
      agg[type] = cur;
    }
  }
  const weakTypes = Object.entries(agg)
    .filter(([, v]) => v.total > 0)
    .sort(([, x], [, y]) => x.correct / x.total - y.correct / y.total)
    .map(([type]) => type);

  // «Recommended for you» — только без активного фильтра и при реальном слабом
  // типе, для которого есть тест в этой секции. Иначе баннер не показываем
  // (никаких выдуманных «your weakest types» без данных).
  let recommended: Test | null = null;
  if (activeCount === 0) {
    for (const wt of weakTypes) {
      const matches = all.filter((t) => t.question_types.includes(wt));
      if (matches.length === 0) continue;
      recommended = matches.find((t) => meetsTier(userTier, t.tier_required)) ?? matches[0];
      break;
    }
  }
  const recWeak = recommended
    ? weakTypes.filter((wt) => recommended!.question_types.includes(wt)).slice(0, 2)
    : [];
  const gridTests = recommended ? tests.filter((t) => t.id !== recommended!.id) : tests;

  // URL-хелперы: переключают одно измерение, сохраняя другое.
  const catHref = (c?: string) => {
    const p = new URLSearchParams();
    if (c) p.set("category", c);
    if (sp.q_type) p.set("q_type", sp.q_type);
    const q = p.toString();
    return q ? `${filterBase}?${q}` : filterBase;
  };
  const typeHref = (t?: string) => {
    const p = new URLSearchParams();
    if (sp.category) p.set("category", sp.category);
    if (t) p.set("q_type", t);
    const q = p.toString();
    return q ? `${filterBase}?${q}` : filterBase;
  };

  return (
    <AppShell active={section}>
      <div style={S.wrap}>
        <h1 style={S.h1}>{title}</h1>
        <p style={S.sub}>{sub}</p>

        {sp.limit === "1" && <CatalogNotice kind="limit" dismissHref={filterBase} />}
        {sp.throttled === "1" && <CatalogNotice kind="throttled" dismissHref={filterBase} />}

        {/* Recommended for you — weak-spot pick */}
        {recommended && (
          <RecommendedBanner test={recommended} weak={recWeak} locked={!meetsTier(userTier, recommended.tier_required)} />
        )}

        {/* Filter panel — URL-based, chips = links */}
        <div style={S.filter}>
          <div style={S.filterHead}>
            <Icon name="filter" size={18} style={{ color: "var(--brand)" }} />
            <span style={S.filterTitle}>Filter</span>
            {activeCount > 0 && <span style={S.filterBadge}>{activeCount}</span>}
            {activeCount > 0 && (
              <Link href={filterBase} style={S.clear}>
                <Icon name="x" size={13} /> Clear
              </Link>
            )}
          </div>

          <div style={S.groupLabel}>Category</div>
          <div style={S.chips}>
            <FilterChip href={catHref()} active={!sp.category} label="All parts" count={totalCount} />
            {categories.map((c) => (
              <FilterChip key={c} href={catHref(c)} active={sp.category === c} label={categoryLabel(c)} count={catCounts[c] ?? 0} />
            ))}
          </div>

          {availableTypes.length > 0 && (
            <>
              <div style={S.divider} />
              <div style={S.groupLabel}>Question type</div>
              <div style={S.chips}>
                <FilterChip href={typeHref()} active={!sp.q_type} label="All types" subtle />
                {availableTypes.map((t) => (
                  <FilterChip key={t} href={typeHref(t)} active={sp.q_type === t} label={qtypeLabel(t)} count={typeCounts[t]} subtle />
                ))}
              </div>
            </>
          )}

          <div style={S.resultRow}>
            <span style={S.resultText}>
              <b style={S.resultNum}>{tests.length}</b> {tests.length === 1 ? "test" : "tests"}
            </span>
          </div>
        </div>

        {/* Cards — compact 2-up grid */}
        {gridTests.length === 0 ? (
          <div style={S.empty}>
            {recommended ? "That's the catalog for now — more tests on the way." : "No tests match this filter yet."}
          </div>
        ) : (
          <div style={S.grid}>
            {gridTests.map((t) => (
              <TestCard key={t.id} t={t} locked={!meetsTier(userTier, t.tier_required)} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* Compact catalog card — всегда: бейдж · Q-count · duration · тип-теги · Start/Lock. */
function TestCard({ t, locked }: { t: Test; locked: boolean }) {
  const isFull = t.category === "full_reading" || t.category === "full_listening";
  const shownTypes = t.question_types.slice(0, 3);
  const extra = t.question_types.length - shownTypes.length;
  return (
    <Link href={locked ? "/app/upgrade" : `/app/reading/${t.id}`} style={{ textDecoration: "none", color: "inherit", height: "100%" }}>
      <Card interactive padding="17px 18px" style={{ display: "flex", flexDirection: "column", height: "100%", opacity: locked ? 0.92 : 1 }}>
        <div style={S.cardTop}>
          <Badge tone="brand">{categoryLabel(t.category)}</Badge>
          {t.question_count > 0 && (
            <Badge mono>
              {t.question_count} Q{isFull ? " · band" : ""}
            </Badge>
          )}
          {t.duration_seconds ? (
            <span style={S.duration}>
              <Icon name="clock" size={12} /> {Math.round(t.duration_seconds / 60)}m
            </span>
          ) : null}
        </div>
        <div style={S.cardTitle}>{t.title}</div>
        <div style={S.types}>
          {shownTypes.map((qt) => (
            <span key={qt} style={S.typeChip}>
              {qtypeLabel(qt)}
            </span>
          ))}
          {extra > 0 && <span style={{ ...S.typeChip, color: "var(--text-disabled)" }}>+{extra}</span>}
        </div>
        <div style={S.cardFoot}>
          {locked ? (
            <span style={S.lockFoot}>
              <Icon name="lock" size={14} /> {TIER_LABEL[t.tier_required]}
            </span>
          ) : (
            <span style={S.startFoot}>
              Start <Icon name="arrow-right" size={14} />
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

/* Brand banner — рекомендованный тест под слабейшие типы пользователя. */
function RecommendedBanner({ test, weak, locked }: { test: Test; weak: string[]; locked: boolean }) {
  return (
    <div style={S.banner}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.bannerEyebrow}>
          <Icon name="target" size={14} strokeWidth={2.6} /> Recommended for you
        </div>
        <div style={S.bannerTitle}>{test.title}</div>
        {weak.length > 0 && (
          <div style={S.bannerText}>
            Targets{" "}
            {weak.map((wt, i) => (
              <span key={wt}>
                {i > 0 ? " & " : ""}
                <b style={{ color: "#fff" }}>{qtypeLabel(wt)}</b>
              </span>
            ))}{" "}
            — your weakest {weak.length === 1 ? "type" : "types"}.
          </div>
        )}
      </div>
      <div style={{ flex: "none", textAlign: "center" }}>
        {test.question_count > 0 && (
          <div style={S.bannerMeta}>
            {test.question_count} Q{test.duration_seconds ? ` · ${Math.round(test.duration_seconds / 60)}m` : ""}
          </div>
        )}
        <Button
          variant="secondary"
          trailingIcon="arrow-right"
          href={locked ? "/app/upgrade" : `/app/reading/${test.id}`}
          style={{ color: "var(--brand-active)", marginTop: 10 }}
        >
          {locked ? "Unlock" : "Start"}
        </Button>
      </div>
    </div>
  );
}

/**
 * CatalogNotice — почему юзера отбросило на каталог. `limit` = исчерпан дневной
 * лимит Basic (с mono-счётчиком и апселлом в Premium); `throttled` = анти-чит
 * velocity-кап. Тактильная карточка с тинт-акцентом, чтобы не молчать. URL-driven
 * (`?limit=1`/`?throttled=1`), крестик ведёт на чистый каталог.
 */
function CatalogNotice({ kind, dismissHref }: { kind: "limit" | "throttled"; dismissHref: string }) {
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
        marginBottom: 18,
      }}
    >
      <span style={{ width: 42, height: 42, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", background: limit ? "var(--warn-subtle)" : "var(--info-subtle)", color: limit ? "var(--warn-text)" : "var(--info)" }}>
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
      <Link href={dismissHref} aria-label="Dismiss notice" style={{ flex: "none", display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "var(--radius-sm)", color: "var(--text-muted)", textDecoration: "none" }}>
        <Icon name="x" size={16} />
      </Link>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "var(--space-8) var(--space-6) var(--space-12)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "0 0 4px", color: "var(--text-primary)" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 16px" },

  banner: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "var(--radius-xl)",
    background: "linear-gradient(150deg, var(--brand), var(--brand-active))",
    color: "#fff",
    padding: "22px 24px",
    margin: "0 0 18px",
    display: "flex",
    alignItems: "center",
    gap: 22,
    boxShadow: "var(--shadow-md)",
  },
  bannerEyebrow: { display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "rgba(255,255,255,0.82)", fontWeight: 600 },
  bannerTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "9px 0 4px" },
  bannerText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.86)" },
  bannerMeta: { fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.8)" },

  filter: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-5)",
    boxShadow: "var(--shadow-sm)",
    marginBottom: 18,
  },
  filterHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--space-4)" },
  filterTitle: { fontFamily: "var(--font-ui)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: "var(--text-primary)" },
  filterBadge: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-on-brand)", background: "var(--brand)", borderRadius: "var(--radius-full)", padding: "2px 8px" },
  clear: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", textDecoration: "none" },
  groupLabel: { textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-muted)", marginBottom: "var(--space-3)" },
  chips: { display: "flex", flexWrap: "wrap", gap: "var(--space-2)" },
  divider: { height: 1, background: "var(--border-subtle)", margin: "var(--space-4) 0" },
  resultRow: { marginTop: "var(--space-5)", display: "flex", alignItems: "center", justifyContent: "space-between" },
  resultText: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" },
  resultNum: { fontFamily: "var(--font-mono)", color: "var(--text-primary)" },

  empty: { padding: "var(--space-8)", textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "stretch" },

  cardTop: { display: "flex", alignItems: "center", gap: 7, marginBottom: 11 },
  duration: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3, letterSpacing: "var(--tracking-snug)", minHeight: 42 },
  types: { display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 15px" },
  typeChip: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", background: "var(--surface-inset)", padding: "3px 9px", borderRadius: "var(--radius-full)" },
  cardFoot: { marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" },
  lockFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--warn-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 },
};
