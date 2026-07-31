"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/core/icons";
import { Badge } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { QuestionFilter } from "@/components/exam/QuestionFilter";
import { CatalogNotice } from "@/components/app/CatalogNotice";
import { qtypeLabel, categoryLabel } from "@/lib/labels";
import { setTargetBand } from "./actions";

/** Valid IELTS targets — same scale the onboarding select offers. */
const BANDS = ["4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];

/**
 * PracticeCatalog — клиентское тело экрана практики (редизайн «bando»). Держит
 * состояние фильтра (категории/типы) и активного скилла; сервер (`page.tsx`)
 * передаёт уже посчитанные реальные данные. Skill-карты Reading/Listening
 * фильтруют список по секции, Writing/Speaking подменяют его на Ultra-панель.
 */

type Section = "reading" | "listening";
type Skill = Section | "writing" | "speaking";

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}
export interface PracticeTest {
  id: string;
  title: string;
  section: Section;
  category: string;
  questionTypes: string[];
  questionCount: number;
  locked: boolean;
  href: string;
  progress: string | null;
}
export interface HeroData {
  kind: "resume" | "recommended" | "first";
  eyebrow: string;
  title: string;
  sub: string;
  cta: string;
  href: string;
  progress: { answered: number; total: number } | null;
  meta: string | null;
}
export type DrillWeakest = { type: string; label: string; section: Section } | null;

/** Предвыбор фильтра из query (redirect со старых каталогов): секция + тип/категория.
 *  Значения уже провалидированы на сервере (page.tsx) против @/lib/labels. */
export interface InitialFilter {
  skill: Section | null;
  types: string[];
  cats: string[];
}

interface SectionVisual {
  tileBg: string;
  tileFg: string;
  icon: IconName;
  label: string;
}
const SECTION: Record<Section, SectionVisual> = {
  reading: { tileBg: "var(--brand-subtle)", tileFg: "var(--text-link)", icon: "book-open", label: "Reading" },
  listening: { tileBg: "var(--info-subtle)", tileFg: "var(--info-text)", icon: "headphones", label: "Listening" },
};

interface ComingInfo {
  name: string;
  color: string;
  subtle: string;
  text: string;
  desc: string;
  items: string[];
}
const COMING: Record<"writing" | "speaking", ComingInfo> = {
  writing: {
    name: "Writing",
    color: "var(--warn)",
    subtle: "var(--warn-subtle)",
    text: "var(--warn-text)",
    desc: "Submit Task 1 and Task 2 and get them scored on task response, coherence, lexical resource and grammar — with a model rewrite of every paragraph.",
    items: ["Task 1 — report or letter", "Task 2 — opinion essay", "Model rewrites + band estimate"],
  },
  speaking: {
    name: "Speaking",
    color: "var(--success)",
    subtle: "var(--success-subtle)",
    text: "var(--success-text)",
    desc: "Record yourself through all three parts and get fluency, vocabulary, grammar and pronunciation scored the moment you finish.",
    items: ["Part 1 — interview", "Part 2 — long turn (cue card)", "Part 3 — discussion"],
  },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PracticeCatalog({
  tests,
  filterCategories,
  filterTypes,
  drillWeakest,
  hero,
  readingMeta,
  listeningMeta,
  targetBand,
  bestBand,
  writingEnabled = false,
  initialFilter,
  notice,
}: {
  tests: PracticeTest[];
  filterCategories: FilterOption[];
  filterTypes: FilterOption[];
  drillWeakest: DrillWeakest;
  hero: HeroData;
  readingMeta: string;
  listeningMeta: string;
  /** Onboarding-set goal; editable inline. null only on the unset edge. */
  targetBand: number | null;
  /** Best single-test band so far (max R/L), or null if no tests submitted. */
  bestBand: number | null;
  /** Writing Lab live (WRITING_EVAL_MODEL set): card → /app/writing, not locked-panel. */
  writingEnabled?: boolean;
  /** Предвыбор фильтра из query (переход со старого каталога). undefined = чистый хаб. */
  initialFilter?: InitialFilter;
  /** Почему отбросило в практику: дневной лимит / throttle сабмита. null = без баннера. */
  notice?: "limit" | "throttled" | null;
}) {
  const router = useRouter();
  const [selCats, setSelCats] = useState<string[]>(initialFilter?.cats ?? []);
  const [selTypes, setSelTypes] = useState<string[]>(initialFilter?.types ?? []);
  const [skill, setSkill] = useState<Skill | null>(initialFilter?.skill ?? null);

  const toggle = (set: (fn: (p: string[]) => string[]) => void) => (v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const toggleCat = toggle(setSelCats);
  const toggleType = toggle(setSelTypes);
  const clearFilter = () => {
    setSelCats([]);
    setSelTypes([]);
  };
  const selectSkill = (k: Skill) => setSkill((s) => (s === k ? null : k));
  const clearSkill = () => setSkill(null);
  const drill = () => {
    if (!drillWeakest) return;
    setSelTypes([drillWeakest.type]);
    setSelCats([]);
    setSkill(drillWeakest.section);
  };

  const skillSection: Section | null = skill === "reading" || skill === "listening" ? skill : null;
  const lockedSkill = skill === "writing" || skill === "speaking" ? skill : null;

  const filtered = tests.filter(
    (t) =>
      (!skillSection || t.section === skillSection) &&
      (selCats.length === 0 || selCats.includes(t.category)) &&
      (selTypes.length === 0 || t.questionTypes.some((x) => selTypes.includes(x))),
  );
  const catalogLabel = skillSection ? `${cap(skillSection)} tests` : "All tests";

  // Подсветка выбранной skill-карты её цветом (фон-тинт + цветная рамка).
  const cardBg = (k: Skill, c: string) => (skill === k ? c : "var(--surface)");
  const cardBd = (k: Skill, c: string) => (skill === k ? c : "var(--border)");

  return (
    <div className="pc-wrap" style={S.wrap}>
      <style>{CSS}</style>

      {/* Почему отбросило сюда: дневной лимит / throttle (URL-driven, ?limit/?throttled) */}
      {notice && <CatalogNotice kind={notice} dismissHref="/app/practice" />}

      {/* Header + hero */}
      <section className="pc-headrow" style={S.headrow}>
        <div>
          <div style={S.overline}>
            <span style={S.overlineDot} />
            Practice library
          </div>
          <h1 className="pc-h1" style={S.h1}>Pick what to drill.</h1>
          <p style={S.sub}>Browse every Reading and Listening test, or filter straight to the question type you want to fix.</p>
          <GoalBar target={targetBand} best={bestBand} />
          {drillWeakest && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
              <button type="button" onClick={drill} style={S.drillChip} className="pc-drill">
                <Icon name="bar-chart" size={16} strokeWidth={2.5} />
                Drill weakest: {drillWeakest.label}
              </button>
            </div>
          )}
        </div>
        <HeroCard hero={hero} />
      </section>

      {/* Skills */}
      <section className="pc-skills" style={S.skills}>
        <SkillCard
          letter="R"
          name="Reading"
          meta={readingMeta}
          tileBg="var(--brand-subtle)"
          tileFg="var(--text-link)"
          badge={{ tone: "success", text: "Live" }}
          onClick={() => selectSkill("reading")}
          bg={cardBg("reading", "var(--brand-subtle)")}
          bd={cardBd("reading", "var(--brand)")}
          pressed={skill === "reading"}
        />
        <SkillCard
          letter="L"
          name="Listening"
          meta={listeningMeta}
          tileBg="var(--info-subtle)"
          tileFg="var(--info-text)"
          badge={{ tone: "success", text: "Live" }}
          onClick={() => selectSkill("listening")}
          bg={cardBg("listening", "var(--info-subtle)")}
          bd={cardBd("listening", "var(--info)")}
          pressed={skill === "listening"}
        />
        <SkillCard
          letter="W"
          name="Writing"
          meta={writingEnabled ? "Live · Task 2" : "Ultra plan"}
          muted={!writingEnabled}
          tileBg="var(--warn-subtle)"
          tileFg="var(--warn-text)"
          badge={writingEnabled ? { tone: "success", text: "Live" } : { tone: "warn", text: "Soon" }}
          onClick={() => (writingEnabled ? router.push("/app/writing") : selectSkill("writing"))}
          bg={cardBg("writing", "var(--warn-subtle)")}
          bd={cardBd("writing", "var(--warn)")}
          expanded={writingEnabled ? undefined : skill === "writing"}
          controls={writingEnabled ? undefined : "pc-locked-panel"}
        />
        <SkillCard
          letter="S"
          name="Speaking"
          meta="Ultra plan"
          muted
          tileBg="var(--success-subtle)"
          tileFg="var(--success-text)"
          badge={{ tone: "warn", text: "Soon" }}
          onClick={() => selectSkill("speaking")}
          bg={cardBg("speaking", "var(--success-subtle)")}
          bd={cardBd("speaking", "var(--success)")}
          expanded={skill === "speaking"}
          controls="pc-locked-panel"
        />
      </section>

      {/* Catalog OR locked-skill panel */}
      <section>
        {lockedSkill ? (
          <LockedPanel skill={lockedSkill} onBack={clearSkill} />
        ) : (
          <div className="pc-catalog" style={S.catalog}>
            <div className="pc-filter" style={S.filterCol}>
              <QuestionFilter
                categories={filterCategories}
                questionTypes={filterTypes}
                selectedCategories={selCats}
                selectedTypes={selTypes}
                onToggleCategory={toggleCat}
                onToggleType={toggleType}
                onClear={clearFilter}
                resultCount={filtered.length}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={S.listHead}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={S.listTitle}>{catalogLabel}</h2>
                  {skill && (
                    <button type="button" onClick={clearSkill} style={S.showAll} className="pc-showall">
                      Show all
                    </button>
                  )}
                </div>
                <span style={S.resultCount}>
                  <b style={{ color: "var(--text-primary)" }}>{filtered.length}</b> results
                </span>
              </div>
              {filtered.length === 0 ? (
                <div style={S.empty}>No tests match this filter yet.</div>
              ) : (
                filtered.map((t) => <TestRow key={t.id} t={t} />)
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Goal bar (target band + gap, inline-editable) ───────────────────────── */
function GoalBar({ target, best }: { target: number | null; best: number | null }) {
  const [value, setValue] = useState(target);
  const [pending, startTransition] = useTransition();
  if (value == null) return null; // unset edge — onboarding normally guarantees it

  const change = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value);
    setValue(next); // optimistic; revalidate confirms server-side
    startTransition(() => {
      void setTargetBand(next.toFixed(1));
    });
  };

  const reached = best != null && best >= value;
  const pct = best != null ? Math.min(100, Math.round((best / value) * 100)) : 0;

  return (
    <div style={S.goal}>
      <span style={S.goalLab}>Target</span>
      <select
        aria-label="Target band"
        value={value.toFixed(1)}
        onChange={change}
        disabled={pending}
        style={S.goalSelect}
      >
        {BANDS.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      {best == null ? (
        <span style={S.goalHint}>Sit a test to measure your gap</span>
      ) : (
        <>
          <span style={S.goalTrack}>
            <span style={{ ...S.goalFill, width: `${pct}%` }} />
          </span>
          <span style={S.goalLab}>
            best test <b style={{ color: "var(--text-primary)" }}>{best.toFixed(1)}</b>
          </span>
          {reached ? (
            <span style={S.goalReached}>Target reached</span>
          ) : (
            <span style={S.goalGap}>+{(value - best).toFixed(1)} to go</span>
          )}
        </>
      )}
    </div>
  );
}

/* ── Hero (resume / recommended / first) ─────────────────────────────────── */
function HeroCard({ hero }: { hero: HeroData }) {
  const pct = hero.progress && hero.progress.total > 0 ? Math.round((hero.progress.answered / hero.progress.total) * 100) : 0;
  return (
    <div style={S.hero}>
      <div>
        <div style={S.heroEyebrow}>{hero.eyebrow}</div>
        <div style={S.heroTitle}>{hero.title}</div>
        <div style={S.heroSub}>{hero.sub}</div>
        {hero.progress ? (
          <div
            style={S.rail}
            role="progressbar"
            aria-label="Test progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${hero.progress.answered} of ${hero.progress.total} answered`}
          >
            <div style={{ height: "100%", width: `${pct}%`, background: "white", borderRadius: "var(--radius-full)" }} />
          </div>
        ) : (
          hero.meta && <div style={S.heroMeta}>{hero.meta}</div>
        )}
      </div>
      <Link href={hero.href} style={S.heroBtn} className="pc-herobtn">
        {hero.cta}
        <Icon name="arrow-right" size={18} strokeWidth={2.75} />
      </Link>
    </div>
  );
}

/* ── Skill card ──────────────────────────────────────────────────────────── */
function SkillCard({
  letter,
  name,
  meta,
  tileBg,
  tileFg,
  badge,
  muted,
  onClick,
  bg,
  bd,
  pressed,
  expanded,
  controls,
}: {
  letter: string;
  name: string;
  meta: string;
  tileBg: string;
  tileFg: string;
  badge: { tone: "success" | "warn"; text: string };
  muted?: boolean;
  onClick: () => void;
  bg: string;
  bd: string;
  /** Reading/Listening — фильтр-тоггл (aria-pressed). */
  pressed?: boolean;
  /** Writing/Speaking — раскрытие locked-панели (aria-expanded + aria-controls). */
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pc-skillcard"
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      style={{ ...S.skillCard, background: bg, borderColor: bd }}
    >
      <div style={S.skillTop}>
        <span style={{ ...S.skillTile, background: tileBg, color: tileFg }}>{letter}</span>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <div style={{ ...S.skillName, color: muted ? "var(--text-secondary)" : "var(--text-primary)" }}>{name}</div>
      <div style={S.skillMeta}>{meta}</div>
    </button>
  );
}

/* ── Test row ────────────────────────────────────────────────────────────── */
function TestRow({ t }: { t: PracticeTest }) {
  const sec = SECTION[t.section];
  const typesLabel = t.questionTypes.slice(0, 3).map(qLabel).join(" · ");
  return (
    <Link href={t.href} style={S.row} className="pc-row">
      <span style={{ ...S.rowTile, background: sec.tileBg, color: sec.tileFg }}>
        <Icon name={sec.icon} size={22} strokeWidth={2.25} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <span style={{ ...S.rowPill, color: sec.tileFg, background: sec.tileBg }}>{sec.label}</span>
          <span style={S.rowMeta}>{cat(t.category)} · {t.questionCount} Q</span>
        </div>
        <div style={S.rowTitle}>{t.title}</div>
        {typesLabel && <div style={S.rowTypes}>{typesLabel}</div>}
      </div>
      <div style={S.rowRight}>
        <span style={S.rowProgress}>{t.progress ?? "—"}</span>
        <span style={t.locked ? S.lockFoot : S.startFoot}>
          {t.locked ? (
            <>
              <Icon name="lock" size={15} /> Unlock
            </>
          ) : (
            <>
              Start <Icon name="arrow-right" size={16} strokeWidth={2.6} />
            </>
          )}
        </span>
      </div>
    </Link>
  );
}

/* ── Locked-skill panel (Writing / Speaking) ─────────────────────────────── */
function LockedPanel({ skill, onBack }: { skill: "writing" | "speaking"; onBack: () => void }) {
  const sk = COMING[skill];
  return (
    <div id="pc-locked-panel" className="pc-locked" style={S.locked}>
      <div className="pc-bars" style={S.bars}>
        <span style={{ ...S.bar, width: "100%", background: sk.color, animation: "pc-grow .6s var(--ease-out) .25s forwards" }} />
        <span style={{ ...S.bar, width: "70%", background: sk.subtle, animation: "pc-grow .6s var(--ease-out) .15s forwards" }} />
        <span style={{ ...S.bar, width: "46%", background: "var(--surface-inset)", animation: "pc-grow .6s var(--ease-out) .05s forwards" }} />
      </div>
      <div>
        <div style={{ ...S.comingPill, background: sk.subtle, color: sk.text }}>Coming soon</div>
        <h2 style={S.lockedTitle}>{sk.name} is on the way</h2>
        <p style={S.lockedDesc}>{sk.desc}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "20px 0 24px" }}>
          {sk.items.map((it) => (
            <span key={it} style={S.featureChip}>{it}</span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Button trailingIcon="arrow-right" href="/app/upgrade">Explore Ultra</Button>
          <Button variant="secondary" href="/app/upgrade">Notify me at launch</Button>
          <button type="button" onClick={onBack} style={S.backBtn} className="pc-back">Back to live tests</button>
        </div>
      </div>
    </div>
  );
}

const qLabel = (v: string) => qtypeLabel(v);
const cat = (v: string) => categoryLabel(v);

/* Адаптив: брейкпоинт-свойства (grid/sticky/padding/font) — в классах, не inline
   (inline перебивает media-query). DOM-порядок = визуальный. */
const CSS = `
.pc-wrap{padding:24px 16px 56px}
.pc-h1{font-size:30px}
.pc-showall{height:38px}
.pc-headrow{display:grid;grid-template-columns:1fr;gap:20px}
.pc-skills{display:grid;grid-template-columns:1fr;gap:14px}
.pc-catalog{display:grid;grid-template-columns:1fr;gap:20px;align-items:start}
.pc-filter{position:static}
.pc-locked{grid-template-columns:1fr}
.pc-bars{order:2}
.pc-skillcard:hover{transform:translateY(-3px);box-shadow:var(--shadow-solid-lg)}
.pc-row:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
.pc-drill:hover{background:var(--surface-hover)!important}
.pc-showall:hover{background:var(--surface-hover)!important;color:var(--text-primary)!important}
.pc-herobtn:active{transform:translateY(4px);box-shadow:none!important}
.pc-back:hover{color:var(--text-primary)!important}
@media (min-width:560px){
  .pc-skills{grid-template-columns:repeat(2,1fr);gap:16px}
  .pc-showall{height:28px}
}
@media (min-width:768px){
  .pc-wrap{padding:32px 28px 72px}
  .pc-h1{font-size:40px}
  .pc-locked{grid-template-columns:auto 1fr;align-items:center}
  .pc-bars{order:0}
}
@media (min-width:1024px){
  .pc-headrow{grid-template-columns:1fr 360px;gap:24px;align-items:stretch}
  .pc-skills{grid-template-columns:repeat(4,1fr)}
  .pc-catalog{grid-template-columns:300px 1fr;gap:24px}
  .pc-filter{position:sticky;top:88px}
}
@keyframes pc-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pc-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){
  .pc-bars{animation:none!important}
  .pc-bars span{animation:none!important;transform:none!important}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 30, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },

  headrow: {},
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 17, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "46ch" },
  drillChip: { display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 16px", borderRadius: "var(--radius-full)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "var(--transition-colors)" },

  // Goal bar — target band + gap, inline-editable target select.
  goal: { marginTop: 20, display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  goalLab: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  goalSelect: { fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-inset)", padding: "4px 8px", cursor: "pointer" },
  goalTrack: { position: "relative", display: "inline-block", width: 120, height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  goalFill: { position: "absolute", insetBlock: 0, left: 0, height: "100%", background: "var(--brand)", borderRadius: "var(--radius-full)" },
  goalGap: { fontSize: 13, fontWeight: 800, color: "var(--text-link)" },
  goalReached: { fontSize: 13, fontWeight: 800, color: "var(--success-text)" },
  goalHint: { fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },

  // Hero — violet 3D-карта, белый ink (WCAG AA на brand).
  hero: { background: "var(--brand)", borderRadius: 22, boxShadow: "0 5px 0 0 var(--brand-edge)", padding: 24, color: "white", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20, minHeight: 200 },
  heroEyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", marginBottom: 10 },
  heroTitle: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.015em", lineHeight: 1.2, textWrap: "balance" },
  heroSub: { fontSize: 13, marginTop: 8, lineHeight: 1.45 },
  rail: { height: 8, borderRadius: "var(--radius-full)", background: "color-mix(in oklab, white 25%, transparent)", overflow: "hidden", marginTop: 14 },
  heroMeta: { fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, marginTop: 12 },
  heroBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 13, background: "white", color: "var(--brand)", fontSize: 15, fontWeight: 800, textDecoration: "none", boxShadow: "0 4px 0 0 color-mix(in oklab, black 18%, transparent)", cursor: "pointer", transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },

  // Skills
  skills: {},
  skillCard: { textAlign: "left", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20, cursor: "pointer", fontFamily: "var(--font-ui)", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)" },
  skillTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  skillTile: { width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 19, fontWeight: 800 },
  skillName: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.015em" },
  skillMeta: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginTop: 4 },

  // Catalog
  catalog: {},
  filterCol: {},
  listHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  listTitle: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  showAll: { display: "inline-flex", alignItems: "center", gap: 5, padding: "0 13px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "var(--transition-colors)" },
  resultCount: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" },
  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  // Test row
  row: { display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "18px 20px", textDecoration: "none", color: "inherit", cursor: "pointer", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  rowTile: { width: 48, height: 48, flex: "none", borderRadius: 13, display: "grid", placeItems: "center" },
  rowPill: { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  rowMeta: { fontSize: 12, color: "var(--text-muted)" },
  rowTitle: { fontSize: 16, fontWeight: 700, color: "var(--text-primary)" },
  rowTypes: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  rowRight: { flex: "none", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  rowProgress: { fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  lockFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 },

  // Locked panel
  locked: { display: "grid", gap: 36, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: 24, boxShadow: "var(--shadow-solid)", padding: 40 },
  bars: { display: "flex", flexDirection: "column", gap: 12, width: 150, animation: "pc-float 6s ease-in-out infinite" },
  bar: { height: 20, borderRadius: "var(--radius-full)", transformOrigin: "left" },
  comingPill: { display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 700, marginBottom: 14 },
  lockedTitle: { margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)" },
  lockedDesc: { margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)", maxWidth: "56ch" },
  featureChip: { display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", padding: "7px 13px", borderRadius: "var(--radius-full)" },
  backBtn: { border: "none", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 8 },
};
