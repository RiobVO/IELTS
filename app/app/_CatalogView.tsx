import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { categoryLabel, qtypeLabel } from "@/lib/labels";
import { AppShell } from "./_AppShell";
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

interface TestRow {
  id: string;
  title: string;
  category: string;
  question_types: string[];
  duration_seconds: number | null;
  tier_required: Tier;
}

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
  sp: { category?: string; q_type?: string };
}) {
  await requireUser();
  const supabase = await createClient();

  const profile = await getProfile();
  const userTier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";

  let query = supabase
    .from("content_item")
    .select("id,title,category,question_types,duration_seconds,tier_required")
    .eq("section", section)
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (sp.category) query = query.eq("category", sp.category);
  if (sp.q_type) query = query.contains("question_types", [sp.q_type]);
  const { data } = await query;
  const tests = (data ?? []) as TestRow[];

  // Полный список секции — для счётчиков по категориям/типам и доступных типов.
  const { data: all } = await supabase
    .from("content_item")
    .select("category,question_types")
    .eq("section", section)
    .eq("status", "published");
  const catCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const r of all ?? []) {
    const cat = r.category as string;
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    for (const qt of (r.question_types as string[]) ?? []) {
      typeCounts[qt] = (typeCounts[qt] ?? 0) + 1;
    }
  }
  const availableTypes = Object.keys(typeCounts).sort();
  const totalCount = (all ?? []).length;
  const activeCount = (sp.category ? 1 : 0) + (sp.q_type ? 1 : 0);

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

        {/* Cards */}
        {tests.length === 0 ? (
          <div style={S.empty}>No tests match this filter yet.</div>
        ) : (
          <div style={S.list}>
            {tests.map((t) => {
              const locked = !meetsTier(userTier, t.tier_required);
              const isFull = t.category === "full_reading" || t.category === "full_listening";
              return (
                <Link key={t.id} href={locked ? "/app/upgrade" : `/app/reading/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <Card interactive padding="var(--space-4)" style={{ opacity: locked ? 0.92 : 1 }}>
                    <div style={S.cardTop}>
                      <Badge tone="brand">{categoryLabel(t.category)}</Badge>
                      {isFull && <Badge>40 Q · band</Badge>}
                      {t.duration_seconds ? (
                        <span style={S.duration}>
                          <Icon name="clock" size={13} /> {Math.round(t.duration_seconds / 60)}m
                        </span>
                      ) : null}
                    </div>
                    <div style={S.cardTitle}>{t.title}</div>
                    <div style={S.types}>
                      {t.question_types.map((qt) => (
                        <span key={qt} style={S.typeChip}>
                          {qtypeLabel(qt)}
                        </span>
                      ))}
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
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "var(--space-8) var(--space-6) var(--space-12)" },
  h1: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "0 0 4px", color: "var(--text-primary)" },
  sub: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 16px" },

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
  list: { display: "flex", flexDirection: "column", gap: 12 },

  cardTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  duration: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" },
  cardTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "var(--tracking-snug)" },
  types: { display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 14px" },
  typeChip: { fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", background: "var(--surface-inset)", padding: "3px 9px", borderRadius: "var(--radius-full)" },
  cardFoot: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  lockFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--warn-text)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 600 },
};
