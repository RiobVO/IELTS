import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { categoryLabel, qtypeLabel } from "@/lib/labels";

/**
 * Shared catalog for Reading and Listening (BRIEF §4.1 — filter by category and
 * question type). Both sections render the same UI; only the section, the
 * category list and the filter base path differ. The exam route is
 * content-generic, so every card links to /app/reading/[id] regardless of
 * section.
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

  const { data: all } = await supabase
    .from("content_item")
    .select("question_types")
    .eq("section", section)
    .eq("status", "published");
  const availableTypes = [
    ...new Set((all ?? []).flatMap((r) => r.question_types as string[])),
  ].sort();

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Link href="/app" style={S.back}>
          ← Дашборд
        </Link>
        <h1 style={S.h1}>{title}</h1>
        <p style={S.sub}>{sub}</p>

        <div style={S.filterRow}>
          <Chip href={filterBase} active={!sp.category} label="Все части" />
          {categories.map((c) => (
            <Chip
              key={c}
              href={`${filterBase}?category=${c}${sp.q_type ? `&q_type=${sp.q_type}` : ""}`}
              active={sp.category === c}
              label={categoryLabel(c)}
            />
          ))}
        </div>

        {availableTypes.length > 0 && (
          <div style={S.filterRow}>
            <Chip
              href={`${filterBase}${sp.category ? `?category=${sp.category}` : ""}`}
              active={!sp.q_type}
              label="Все типы"
              subtle
            />
            {availableTypes.map((t) => (
              <Chip
                key={t}
                href={`${filterBase}?${sp.category ? `category=${sp.category}&` : ""}q_type=${t}`}
                active={sp.q_type === t}
                label={qtypeLabel(t)}
                subtle
              />
            ))}
          </div>
        )}

        {tests.length === 0 ? (
          <div style={S.empty}>Нет тестов под этот фильтр.</div>
        ) : (
          <div style={S.grid}>
            {tests.map((t) => {
              const locked = !meetsTier(userTier, t.tier_required);
              return (
                <Link
                  key={t.id}
                  href={locked ? "/app/upgrade" : `/app/reading/${t.id}`}
                  style={S.card}
                >
                  <div style={S.cardTop}>
                    <span style={S.badge}>{categoryLabel(t.category)}</span>
                    <div style={S.cardTopRight}>
                      {locked && (
                        <span style={S.lock}>🔒 {TIER_LABEL[t.tier_required]}</span>
                      )}
                      {t.duration_seconds ? (
                        <span style={S.duration}>
                          {Math.round(t.duration_seconds / 60)} мин
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div style={S.cardTitle}>{t.title}</div>
                  <div style={S.types}>
                    {t.question_types.map((qt) => (
                      <span key={qt} style={S.typeChip}>
                        {qtypeLabel(qt)}
                      </span>
                    ))}
                  </div>
                  <div style={S.start}>
                    {locked ? "Открыть на Premium →" : "Начать →"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Chip({
  href,
  active,
  label,
  subtle,
}: {
  href: string;
  active: boolean;
  label: string;
  subtle?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        ...S.chip,
        ...(subtle ? S.chipSubtle : {}),
        ...(active ? S.chipActive : {}),
      }}
    >
      {label}
    </Link>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2rem 1.25rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 880, margin: "0 auto" },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  h1: { fontSize: "1.8rem", margin: ".5rem 0 .25rem" },
  sub: { color: "#777", margin: "0 0 1.25rem" },
  filterRow: { display: "flex", flexWrap: "wrap", gap: ".5rem", margin: "0 0 .75rem" },
  chip: {
    padding: ".4rem .8rem",
    borderRadius: 999,
    border: "1px solid #e3e3e8",
    background: "#fff",
    color: "#333",
    fontSize: ".85rem",
    fontWeight: 600,
  },
  chipSubtle: { fontWeight: 500, fontSize: ".8rem", color: "#555" },
  chipActive: { background: "#6C5CE7", color: "#fff", borderColor: "#6C5CE7" },
  grid: { display: "grid", gap: ".9rem", marginTop: "1.25rem" },
  card: {
    display: "block",
    border: "1px solid #ececf1",
    borderRadius: 14,
    padding: "1.1rem 1.2rem",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,.03)",
    color: "inherit",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: ".5rem",
  },
  badge: {
    background: "#efeafe",
    color: "#5a44d6",
    fontWeight: 700,
    fontSize: ".72rem",
    padding: "3px 9px",
    borderRadius: 6,
  },
  cardTopRight: { display: "flex", alignItems: "center", gap: ".5rem" },
  lock: {
    background: "#fff4e5",
    color: "#b45309",
    fontWeight: 700,
    fontSize: ".72rem",
    padding: "3px 9px",
    borderRadius: 6,
  },
  duration: { color: "#999", fontSize: ".8rem" },
  cardTitle: { fontSize: "1.05rem", fontWeight: 700, marginBottom: ".6rem" },
  types: { display: "flex", flexWrap: "wrap", gap: ".35rem", marginBottom: ".75rem" },
  typeChip: {
    fontSize: ".72rem",
    color: "#666",
    background: "#f5f5f8",
    padding: "2px 8px",
    borderRadius: 5,
  },
  start: { color: "#6C5CE7", fontWeight: 700, fontSize: ".9rem" },
  empty: {
    marginTop: "1.5rem",
    padding: "2rem",
    textAlign: "center",
    color: "#999",
    border: "1px dashed #ddd",
    borderRadius: 12,
  },
};
