"use client";

import { useState, useTransition, useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";
import { Badge } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { QuestionFilter } from "@/components/exam/QuestionFilter";
import { CatalogNotice } from "@/components/app/CatalogNotice";
import { qtypeLabel, categoryLabel, qtypeDescription } from "@/lib/labels";
import { setTargetBand } from "./actions";

/** Valid IELTS targets — same scale the onboarding select offers. */
const BANDS = ["4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];

/**
 * PracticeCatalog — клиентское тело экрана практики (редизайн «bando»). Держит
 * состояние фильтра (категории/типы) и активного скилла; сервер (`page.tsx`)
 * передаёт уже посчитанные реальные данные.
 *
 * Иерархия закоммичена в посчитанный приоритет: hero (resume/recommended/first) —
 * единственное доминирующее действие, drill-чип живёт под ним как вторичный.
 * Живые Reading/Listening — фильтр-карты; locked Writing/Speaking вынесены в
 * отдельную лёгкую «Coming soon»-полосу и раскрываются НЕРАЗРУШАЮЩЕ (каталог
 * остаётся виден), а не свопом всего каталога.
 */

type Section = "reading" | "listening";
type Skill = Section | "writing" | "speaking";
type Sort = "default" | "short" | "questions";

/** Проброс CSS-переменной в style без нарушения инварианта «брейкпоинт-свойства в
 *  классах»: инлайн отдаёт лишь скаляр (--live-cols), а переключение колонок по
 *  ширине остаётся в media-query CSS-класса. */
const cssVar = (vars: Record<string, string | number>): CSSProperties => vars as unknown as CSSProperties;

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
  /** Длительность в минутах — продаёт непройденный тест вместо опакового «—». */
  durationMin: number | null;
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
  readingCount,
  listeningCount,
  readingBand,
  listeningBand,
  targetBand,
  bestBand,
  writingEnabled = false,
  speakingEnabled = false,
  initialFilter,
  notice,
}: {
  tests: PracticeTest[];
  filterCategories: FilterOption[];
  filterTypes: FilterOption[];
  drillWeakest: DrillWeakest;
  hero: HeroData;
  /** Count line per live skill, e.g. "12 tests". */
  readingCount: string;
  listeningCount: string;
  /** User's best band on the skill (per-section best), or null with no attempts. */
  readingBand: number | null;
  listeningBand: number | null;
  /** Onboarding-set goal; editable inline. null only on the unset edge. */
  targetBand: number | null;
  /** Best single-test band so far (max R/L), or null if no tests submitted. */
  bestBand: number | null;
  /** Writing Lab live (WRITING_EVAL_MODEL set): card → /app/writing, not locked-panel. */
  writingEnabled?: boolean;
  /** Speaking Lab live (SPEAKING_EVAL_MODEL set): card → /app/speaking, not locked-panel. */
  speakingEnabled?: boolean;
  /** Предвыбор фильтра из query (переход со старого каталога). undefined = чистый хаб. */
  initialFilter?: InitialFilter;
  /** Почему отбросило в практику: дневной лимит / throttle сабмита. null = без баннера. */
  notice?: "limit" | "throttled" | null;
}) {
  const [selCats, setSelCats] = useState<string[]>(initialFilter?.cats ?? []);
  const [selTypes, setSelTypes] = useState<string[]>(initialFilter?.types ?? []);
  const [skill, setSkill] = useState<Skill | null>(initialFilter?.skill ?? null);
  const [sort, setSort] = useState<Sort>("default");
  // Мобильный фильтр свёрнут по умолчанию (стена чипов не загораживает список);
  // на десктопе (≥1024) всегда раскрыт. matchMedia — как бургер-паттерн проекта.
  const [filtersOpen, setFiltersOpen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setFiltersOpen(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Фильтр-действие выше сгиба (skill-карта / drill) меняет каталог ниже — ведём
  // пользователя к результату: скролл каталога + фокус на заголовок списка
  // (aria-live ниже озвучит счёт). Уважаем prefers-reduced-motion.
  const catalogRef = useRef<HTMLElement>(null);
  const listHeadRef = useRef<HTMLDivElement>(null);
  const revealCatalog = () => {
    const el = catalogRef.current;
    // Скроллим ТОЛЬКО когда каталог реально вне зоны видимости (ниже сгиба / выше
    // вьюпорта) — не дёргаем мышиных юзеров, у которых список уже на экране.
    if (el) {
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }
    // Фокус на заголовок — всегда (для скринридера); сам по себе не скроллит.
    listHeadRef.current?.focus({ preventScroll: true });
  };

  const toggle = (set: (fn: (p: string[]) => string[]) => void) => (v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  const toggleCat = toggle(setSelCats);
  const toggleType = toggle(setSelTypes);
  const clearFilter = () => {
    setSelCats([]);
    setSelTypes([]);
  };
  const selectSkill = (k: Skill) => {
    setSkill((s) => (s === k ? null : k));
    if (k === "reading" || k === "listening") revealCatalog();
  };
  const clearSkill = () => setSkill(null);
  const drill = () => {
    if (!drillWeakest) return;
    setSelTypes([drillWeakest.type]);
    setSelCats([]);
    setSkill(drillWeakest.section);
    revealCatalog();
  };
  const activeFilterCount = selCats.length + selTypes.length;

  const skillSection: Section | null = skill === "reading" || skill === "listening" ? skill : null;
  const lockedSkill = skill === "writing" || skill === "speaking" ? skill : null;

  const filtered = tests.filter(
    (t) =>
      (!skillSection || t.section === skillSection) &&
      (selCats.length === 0 || selCats.includes(t.category)) &&
      (selTypes.length === 0 || t.questionTypes.some((x) => selTypes.includes(x))),
  );
  const catalogLabel = skillSection ? `${cap(skillSection)} tests` : "All tests";
  // Сортировка. «Recommended» (default) теперь честная: при известном слабом типе
  // поднимает тесты с этим типом наверх (стабильно — V8 sort сохраняет порядок
  // внутри групп), иначе исходный reading→listening. short/questions — явные.
  const weakType = drillWeakest?.type ?? null;
  const visible =
    sort === "short"
      ? [...filtered].sort((a, b) => (a.durationMin ?? Infinity) - (b.durationMin ?? Infinity))
      : sort === "questions"
        ? [...filtered].sort((a, b) => b.questionCount - a.questionCount)
        : weakType
          ? [...filtered].sort(
              (a, b) =>
                Number(b.questionTypes.includes(weakType)) -
                Number(a.questionTypes.includes(weakType)),
            )
          : filtered;

  // Живые скиллы (фильтр-карты) vs «Coming soon» (locked-тизеры). Writing/Speaking
  // живут в обеих ролях по флагу ops-гейта: live → ссылка, иначе → coming-полоса.
  const liveCols = 2 + (writingEnabled ? 1 : 0) + (speakingEnabled ? 1 : 0);
  const comingSkills: ("writing" | "speaking")[] = [
    ...(writingEnabled ? [] : (["writing"] as const)),
    ...(speakingEnabled ? [] : (["speaking"] as const)),
  ];

  return (
    <div className="pc-wrap" style={S.wrap}>
      <style>{CSS}</style>

      {/* Почему отбросило сюда: дневной лимит / throttle (URL-driven, ?limit/?throttled) */}
      {notice && <CatalogNotice kind={notice} dismissHref="/app/practice" />}

      {/* Header + hero. Левая колонка — контекст (что это + твоя цель); правая —
          «твой следующий ход»: доминирующий hero-CTA + вторичный drill-чип. */}
      <section className="pc-headrow" style={S.headrow}>
        <div>
          <div style={S.overline}>
            <span style={S.overlineDot} />
            Practice library
          </div>
          <h1 className="pc-h1" style={S.h1}>Pick what to drill.</h1>
          <p style={S.sub}>Browse every Reading and Listening test, or filter straight to the question type you want to fix.</p>
          <GoalBar target={targetBand} best={bestBand} />
        </div>
        <div className="pc-herocol">
          <HeroCard hero={hero} />
          {hero.kind === "recommended" ? (
            // Hero УЖЕ ведёт к слабому типу (конкретный тест) → drill подчинён: тихая
            // ссылка «все тесты этого типа», а не второй громкий 3D-чип-дубль.
            drillWeakest && (
              <button type="button" onClick={drill} style={S.drillLink} className="pc-drilllink">
                See all {drillWeakest.label} tests
                <Icon name="arrow-right" size={14} strokeWidth={2.5} />
              </button>
            )
          ) : drillWeakest ? (
            // Resume-hero (про «продолжить») → слабый тип — отдельная мысль, заметный чип.
            <button type="button" onClick={drill} style={S.drillChip} className="pc-drill">
              <Icon name="bar-chart" size={16} strokeWidth={2.5} />
              Practice your weakest type: {drillWeakest.label}
            </button>
          ) : (
            hero.kind === "first" && (
              <div style={S.firstNote}>
                <Icon name="target" size={16} strokeWidth={2.5} style={{ color: "var(--text-link)", marginTop: 1 }} />
                <span>Your first test sets your baseline — no pressure, you can pause and resume anytime.</span>
              </div>
            )
          )}
        </div>
      </section>

      {/* Live skills — фильтр-карты Reading/Listening (+ Writing когда ops-гейт открыт) */}
      <section>
        <div style={S.skillHead}>Jump to a skill</div>
        <div className="pc-skills" style={cssVar({ "--live-cols": liveCols })}>
          <SkillCard
            skill="reading"
            name="Reading"
            count={readingCount}
            band={readingBand}
            targetBand={targetBand}
            onClick={() => selectSkill("reading")}
            pressed={skill === "reading"}
          />
          <SkillCard
            skill="listening"
            name="Listening"
            count={listeningCount}
            band={listeningBand}
            targetBand={targetBand}
            onClick={() => selectSkill("listening")}
            pressed={skill === "listening"}
          />
          {writingEnabled && (
            // Live → настоящая навигация: ссылка (middle-click / новая вкладка, link-семантика).
            <SkillCard
              skill="writing"
              name="Writing"
              count="Task 1 & 2"
              band={null}
              targetBand={targetBand}
              href="/app/writing"
            />
          )}
          {speakingEnabled && (
            <SkillCard
              skill="speaking"
              name="Speaking"
              count="Part 2 long-turn"
              band={null}
              targetBand={targetBand}
              href="/app/speaking"
            />
          )}
        </div>
      </section>

      {/* Coming soon — НАД каталогом по решению пользователя (проект ещё демо, апселл
          наверху приемлем). Тап раскрывает детали неразрушающе (каталог ниже остаётся). */}
      <section>
        <div style={S.comingHead}>Coming soon</div>
        <div className="pc-coming" style={S.coming}>
          {comingSkills.map((k) => (
            <ComingItem
              key={k}
              skill={k}
              expanded={skill === k}
              onClick={() => selectSkill(k)}
            />
          ))}
        </div>
        {lockedSkill && <LockedPanel skill={lockedSkill} onBack={clearSkill} />}
      </section>

      {/* Catalog — фильтр (сворачиваемый на мобиле) + список. Ведём фокус сюда при
          выборе скилла, чтобы действие выше сгиба не было «невидимым». */}
      <section ref={catalogRef}>
        <div className="pc-catalog" style={S.catalog}>
          <div className="pc-filter" style={S.filterCol}>
            <button
              type="button"
              className="pc-filter-toggle"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="pc-filter-body"
              style={S.filterToggle}
            >
              <Icon name="filter" size={16} strokeWidth={2.5} />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              <Icon name={filtersOpen ? "chevron-up" : "chevron-down"} size={16} strokeWidth={2.5} style={{ marginLeft: "auto" }} />
            </button>
            <div id="pc-filter-body" className={filtersOpen ? "pc-filter-body is-open" : "pc-filter-body"}>
              <QuestionFilter
                categories={filterCategories}
                questionTypes={filterTypes}
                selectedCategories={selCats}
                selectedTypes={selTypes}
                onToggleCategory={toggleCat}
                onToggleType={toggleType}
                onClear={clearFilter}
              />
            </div>
            {/* ESL-хелп: что значит каждый тип. Вне сворачиваемого тела — виден и на
                мобиле при свёрнутом фильтре. Нативный <details> = a11y/тач без hover. */}
            <QuestionTypeGlossary types={filterTypes} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* tabIndex -1: программный фокус при выборе скилла (SR озвучит заголовок) */}
            <div style={S.listHead} ref={listHeadRef} tabIndex={-1}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={S.listTitle}>{catalogLabel}</h2>
                {skillSection && (
                  <button type="button" onClick={clearSkill} style={S.showAll} className="pc-showall">
                    Show all
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={S.sortWrap} className="pc-goalselect">
                  <select
                    aria-label="Sort tests"
                    className="pc-goalsel"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    style={S.sortSelect}
                  >
                    <option value="default">Recommended</option>
                    <option value="short">Shortest first</option>
                    <option value="questions">Most questions</option>
                  </select>
                  <Icon name="chevron-down" size={14} strokeWidth={2.5} style={S.goalChevron} />
                </span>
                <span style={S.resultCount}>
                  <b style={{ color: "var(--text-primary)" }}>{filtered.length}</b> results
                </span>
              </div>
            </div>
            {/* Эхо активного фильтра при свёрнутой панели (мобайл): видно, что
                ограничивает список, без открытия фильтра (recognition). */}
            {!filtersOpen && activeFilterCount > 0 && (
              <div style={S.activeEcho}>
                <span style={S.echoLabel}>Filtering:</span>
                {selTypes.map((v) => (
                  <span key={v} style={S.echoChip}>{qLabel(v)}</span>
                ))}
                {selCats.map((v) => (
                  <span key={v} style={S.echoChip}>{cat(v)}</span>
                ))}
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={S.empty}>
                <div>No tests match this filter yet.</div>
                {(selCats.length > 0 || selTypes.length > 0 || skillSection) && (
                  <button
                    type="button"
                    onClick={() => { clearFilter(); clearSkill(); }}
                    style={{ ...S.showAll, marginTop: 14 }}
                    className="pc-showall"
                  >
                    <Icon name="x" size={13} /> Clear filters
                  </button>
                )}
              </div>
            ) : (
              visible.map((t) => <TestRow key={t.id} t={t} />)
            )}
          </div>
        </div>
        {/* SR-анонс счёта И порядка сортировки (иначе тихая перестановка списка
            незаметна скринридеру — счёт-то не меняется). */}
        <div aria-live="polite" style={S.srOnly}>
          {filtered.length} {filtered.length === 1 ? "test" : "tests"} shown
          {sort === "short" ? ", sorted shortest first" : sort === "questions" ? ", sorted by most questions" : ""}
        </div>
      </section>
    </div>
  );
}

/* ── Goal bar (target band + gap, inline-editable) ───────────────────────── */
function GoalBar({ target, best }: { target: number | null; best: number | null }) {
  const [value, setValue] = useState(target);
  const [pending, startTransition] = useTransition();
  // Озвучка оптимистичной записи: aria-live для скринридера + видимый «Saved»-тик
  // (визуальное подтверждение, что цель записалась), затухающий через ~1.8с.
  // Подтверждение оптимистичной записи: aria-live для скринридера + видимый
  // транзиент (Saved/Error), затухающий через ~1.8с. Честно: «Saved» только на
  // resolve; reject откатывает значение и показывает ошибку (не врём «сохранено»).
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(id);
  }, [saved]);

  if (value == null) return null; // unset edge — onboarding normally guarantees it

  const change = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value);
    const prev = value;
    setValue(next); // optimistic
    setError(false);
    startTransition(() => {
      setTargetBand(next.toFixed(1))
        .then(() => {
          setSaved(true);
          setStatus(`Target band set to ${next.toFixed(1)}`);
        })
        .catch(() => {
          setValue(prev); // откат оптимизма — не оставляем непросохранённое значение
          setError(true);
          setStatus("Couldn't save your target — please try again");
        });
    });
  };

  const reached = best != null && best >= value;
  const pct = best != null ? Math.min(100, Math.round((best / value) * 100)) : 0;
  // Saved/Error замещают gap-текст транзиентно — не плодим лишний элемент в пилюле.
  const tail = error ? (
    <span style={S.goalError}>Couldn&apos;t save — try again</span>
  ) : saved ? (
    <span style={S.goalSaved} className="pc-goalsaved">
      <Icon name="check" size={13} strokeWidth={3} /> Saved
    </span>
  ) : null;

  return (
    <div style={S.goal}>
      <span style={S.goalLab}>Target</span>
      {/* appearance:none + собственный chevron — чтобы mono-пилюля явно читалась
          как редактируемый контрол (нативная стрелка была единственным сигналом). */}
      <span style={S.goalSelectWrap} className="pc-goalselect">
        <select
          aria-label="Target band"
          className="pc-goalsel"
          value={value.toFixed(1)}
          onChange={change}
          disabled={pending}
          style={S.goalSelect}
        >
          {BANDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} strokeWidth={2.5} style={S.goalChevron} />
      </span>
      {best == null ? (
        tail ?? <span style={S.goalHint}>Take a test to measure your gap</span>
      ) : (
        <>
          <span style={S.goalTrack}>
            <span style={{ ...S.goalFill, width: `${pct}%` }} />
          </span>
          {/* «best single test» явным текстом — а не tooltip'ом: телефонной/клавиатурной
              аудитории hover недоступен, а число рядом с Target читалось как офиц. band. */}
          <span style={S.goalLab}>
            best single test{" "}
            <b style={{ color: "var(--text-primary)" }}>{best.toFixed(1)}</b>
          </span>
          {tail ?? (reached ? (
            <span style={S.goalReached}>Target reached</span>
          ) : (
            <span style={S.goalGap}>+{(value - best).toFixed(1)} to target</span>
          ))}
        </>
      )}
      <span role="status" aria-live="polite" style={S.srOnly}>{status}</span>
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
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--text-on-brand)", borderRadius: "var(--radius-full)" }} />
          </div>
        ) : (
          hero.meta && <div style={S.heroMeta}>{hero.meta}</div>
        )}
      </div>
      <Button variant="inverse" trailingIcon="arrow-right" href={hero.href} fullWidth>{hero.cta}</Button>
    </div>
  );
}

/* ── Skill card (live Reading / Listening / Writing / Speaking) ──────────────
   Tactile bando tile: letter chip (soft fill / ink text) + Live pill, name +
   count, a BAND block (the user's best band on a 0–9 rail with a target marker),
   and the action affordance. Per-skill colour is the given oklch palette (base =
   fill / ink = text / soft = chip bg) — applied inline, the bando tokens (surface,
   border, text, success) stay var(--*). */
type SkillKey = "reading" | "listening" | "writing" | "speaking";

const SKILL_PALETTE: Record<SkillKey, { letter: string; base: string; soft: string; ink: string }> = {
  reading: { letter: "R", base: "oklch(0.585 0.225 292)", soft: "oklch(0.955 0.030 290)", ink: "oklch(0.50 0.205 292)" },
  listening: { letter: "L", base: "oklch(0.60 0.135 235)", soft: "oklch(0.93 0.055 232)", ink: "oklch(0.49 0.130 238)" },
  writing: { letter: "W", base: "oklch(0.64 0.135 70)", soft: "oklch(0.94 0.075 85)", ink: "oklch(0.56 0.120 65)" },
  speaking: { letter: "S", base: "oklch(0.585 0.150 158)", soft: "oklch(0.93 0.070 156)", ink: "oklch(0.49 0.130 160)" },
};

function SkillCard({
  skill,
  name,
  count,
  band,
  targetBand,
  onClick,
  href,
  pressed,
}: {
  skill: SkillKey;
  name: string;
  count: string;
  /** User's best band on this skill, or null with no attempts yet. */
  band: number | null;
  /** Goal band; defaults to 7.0 when the user hasn't set one. */
  targetBand: number | null;
  /** Тоггл-карты (Reading/Listening). Не задаётся для href-варианта. */
  onClick?: () => void;
  /** Если задан — карта это ссылка-навигация (live Writing/Speaking), а не тоггл. */
  href?: string;
  /** Reading/Listening — фильтр-тоггл (aria-pressed). */
  pressed?: boolean;
}) {
  const p = SKILL_PALETTE[skill];
  const inner = (
    <>
      <div style={S.skillTop}>
        <span style={{ ...S.skillTile, background: p.soft, color: p.ink }}>{p.letter}</span>
        <Badge tone="success">Live</Badge>
      </div>
      <div>
        <div style={S.skillName}>{name}</div>
        <div style={S.skillCount}>{count}</div>
      </div>
      <SkillBand band={band} target={targetBand ?? 7} base={p.base} ink={p.ink} />
      {/* Нижний аффорданс — ссылка → Open, тоггл → Filter tests / Showing below. */}
      <div style={S.skillFoot}>
        {href ? (
          // Диагональная стрелка = «уйдёшь со страницы» (live W/S — навигация, не фильтр).
          <>Open {name} <Icon name="arrow-up-right" size={15} strokeWidth={2.5} /></>
        ) : pressed ? (
          <><Icon name="chevron-down" size={15} strokeWidth={2.5} /> Showing below</>
        ) : (
          <>Filter tests <Icon name="arrow-right" size={15} strokeWidth={2.5} /></>
        )}
      </div>
    </>
  );
  // Selected filter-card keeps a subtle skill-tinted state; resting = surface/border.
  const style = {
    ...S.skillCard,
    background: pressed ? p.soft : "var(--surface)",
    borderColor: pressed ? p.base : "var(--border)",
  };

  // Навигация → ссылка (link-семантика, middle-click / новая вкладка).
  if (href) {
    return (
      <Link href={href} className="pc-skillcard" style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="pc-skillcard" aria-pressed={pressed} style={style}>
      {inner}
    </button>
  );
}

/* BAND block — best band as a fill on a shared 0–9 rail with a target marker.
   Reads colour-independently: the value + caption carry the number, the marker the
   goal. No band yet → empty rail + "—". */
function SkillBand({ band, target, base, ink }: { band: number | null; target: number; base: string; ink: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / 9) * 100))}%`;
  return (
    <div style={S.bandBlock}>
      <div style={S.bandRow}>
        <span style={S.bandOver}>BAND</span>
        <span style={{ ...S.bandVal, color: ink }}>{band != null ? band.toFixed(1) : "—"}</span>
      </div>
      {/* Target — единственный источник в goal-баре; на рейле оставляем только fill
          (per-skill band), а target несём словами в aria-label для скринридера. */}
      <div
        style={S.bandTrack}
        role="img"
        aria-label={band != null ? `Best band ${band.toFixed(1)} of 9, target ${target.toFixed(1)}` : `No band yet, target ${target.toFixed(1)}`}
      >
        {band != null && <span style={{ ...S.bandFill, width: pct(band), background: base }} />}
      </div>
    </div>
  );
}

/* ── Coming-soon item (locked Writing / Speaking — subordinated strip) ────── */
function ComingItem({
  skill,
  expanded,
  onClick,
}: {
  skill: "writing" | "speaking";
  expanded: boolean;
  onClick: () => void;
}) {
  const sk = COMING[skill];
  return (
    <button
      type="button"
      id={`pc-skill-${skill}`}
      onClick={onClick}
      className="pc-coming-item"
      aria-expanded={expanded}
      aria-controls={expanded ? "pc-locked-panel" : undefined}
      style={{ ...S.comingItem, borderColor: expanded ? sk.color : "var(--border)", background: expanded ? sk.subtle : "var(--surface)" }}
    >
      <span style={{ ...S.comingTile, background: sk.subtle, color: sk.text }}>{sk.name.charAt(0)}</span>
      <span style={S.comingName}>{sk.name}</span>
      {/* Нейтральный тон: один статус «Soon» = один цвет; зелёный читался как «доступно». */}
      <Badge tone="neutral">Soon</Badge>
      <Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} strokeWidth={2.5} style={{ color: "var(--text-muted)", marginLeft: 2 }} />
    </button>
  );
}

/* ── Question-type glossary (ESL help) — native <details>, lists catalog types ── */
function QuestionTypeGlossary({ types }: { types: FilterOption[] }) {
  if (types.length === 0) return null;
  return (
    <details className="pc-gloss">
      <summary>
        <Icon name="info" size={15} strokeWidth={2.5} style={{ color: "var(--text-link)" }} />
        What do these question types mean?
        <Icon name="chevron-down" size={15} strokeWidth={2.5} className="pc-gloss-chev" style={{ marginLeft: "auto" }} />
      </summary>
      <dl style={S.glossList}>
        {types.map((t) => {
          const desc = qtypeDescription(t.value);
          if (!desc) return null;
          return (
            <div key={t.value}>
              <dt style={S.glossTerm}>{t.label}</dt>
              <dd style={S.glossDef}>{desc}</dd>
            </div>
          );
        })}
      </dl>
    </details>
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
        {/* Начатый тест → прогресс; непройденный → длительность (продаёт тест),
            а не опаковый «—», который скринридер читает как «em dash». */}
        {t.progress ? (
          <span style={S.rowProgress}>{t.progress}</span>
        ) : t.durationMin ? (
          <span style={S.rowDuration}>
            <Icon name="clock" size={13} strokeWidth={2.5} /> {t.durationMin}m
          </span>
        ) : null}
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

/* ── Locked-skill panel (Writing / Speaking) — inline, non-destructive ───── */
function LockedPanel({ skill, onBack }: { skill: "writing" | "speaking"; onBack: () => void }) {
  const sk = COMING[skill];
  // Раскрытие подменяет контент внутри секции: переносим фокус на заголовок,
  // чтобы скринридер озвучил новую панель. На «Back» — возвращаем фокус на
  // coming-айтем, что раскрыл панель (id="pc-skill-…").
  const titleRef = useRef<HTMLHeadingElement>(null);
  const back = () => {
    document.getElementById(`pc-skill-${skill}`)?.focus();
    onBack();
  };
  useEffect(() => {
    titleRef.current?.focus(); // озвучить новую панель скринридеру при раскрытии
  }, []);
  // Esc закрывает панель и возвращает фокус на coming-айтем (WCAG 2.1.2 / user control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        document.getElementById(`pc-skill-${skill}`)?.focus();
        onBack();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skill, onBack]);
  return (
    <div id="pc-locked-panel" className="pc-locked" style={S.locked} role="region" aria-labelledby="pc-locked-title">
      <div className="pc-bars" style={S.bars}>
        <span style={{ ...S.bar, width: "100%", background: sk.color, animation: "pc-grow .6s var(--ease-out) .25s forwards" }} />
        <span style={{ ...S.bar, width: "70%", background: sk.subtle, animation: "pc-grow .6s var(--ease-out) .15s forwards" }} />
        <span style={{ ...S.bar, width: "46%", background: "var(--surface-inset)", animation: "pc-grow .6s var(--ease-out) .05s forwards" }} />
      </div>
      <div>
        <div style={{ ...S.comingPill, background: sk.subtle, color: sk.text }}>Coming soon</div>
        <h2 id="pc-locked-title" ref={titleRef} tabIndex={-1} style={{ ...S.lockedTitle, outline: "none" }}>{sk.name} is on the way</h2>
        <p style={S.lockedDesc}>{sk.desc}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "20px 0 24px" }}>
          {sk.items.map((it) => (
            <span key={it} style={S.featureChip}>{it}</span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Button trailingIcon="arrow-right" href="/app/upgrade">Explore Ultra</Button>
          <Button variant="secondary" href="/app/upgrade">Notify me at launch</Button>
          <Button variant="ghost" onClick={back}>Close</Button>
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
.pc-herocol{display:flex;flex-direction:column;gap:14px}
.pc-skills{display:grid;grid-template-columns:1fr;gap:14px}
.pc-coming{display:flex;flex-wrap:wrap;gap:12px}
.pc-catalog{display:grid;grid-template-columns:1fr;gap:20px;align-items:start}
.pc-filter{position:static}
.pc-locked{grid-template-columns:1fr}
.pc-bars{order:2}
.pc-skillcard:hover{transform:translateY(-3px);box-shadow:var(--shadow-solid-lg)}
.pc-coming-item:hover{border-color:var(--brand-border)!important;background:var(--surface-hover)!important}
.pc-row:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
.pc-drill:hover{border-color:var(--brand)!important}
.pc-drill:active{transform:translateY(3px);box-shadow:none!important}
.pc-drilllink:hover{text-decoration:underline}
.pc-gloss{margin-top:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);box-shadow:var(--shadow-xs)}
.pc-gloss>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;cursor:pointer;list-style:none;font-family:var(--font-ui);font-size:13px;font-weight:700;color:var(--text-primary)}
.pc-gloss>summary::-webkit-details-marker{display:none}
.pc-gloss>summary:hover{background:var(--surface-hover);border-radius:var(--radius-md)}
.pc-gloss>summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:var(--radius-md)}
.pc-gloss-chev{transition:transform var(--duration-base) var(--ease-standard)}
.pc-gloss[open] .pc-gloss-chev{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){.pc-gloss-chev{transition:none}}
.pc-showall:hover{background:var(--surface-hover)!important;color:var(--text-primary)!important}
.pc-goalselect:hover select{background:var(--surface-hover)}
.pc-goalsaved{animation:pc-fade .18s var(--ease-out)}
.pc-filter-toggle{display:none}
.pc-filter-body{display:block}
@media (max-width:1023px){
  .pc-filter-toggle{display:flex}
  .pc-filter-body{display:none}
  .pc-filter-body.is-open{display:block}
}
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
  .pc-skills{grid-template-columns:repeat(var(--live-cols,2),1fr)}
  .pc-catalog{grid-template-columns:300px 1fr;gap:24px}
  .pc-filter{position:sticky;top:88px}
}
@keyframes pc-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pc-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@media (pointer:coarse){.pc-showall{min-height:44px}.pc-goalsel{min-height:44px}}
@media (prefers-reduced-motion:reduce){
  .pc-bars span{animation:none!important;transform:none!important}
  .pc-goalsaved{animation:none!important}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 30, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },

  headrow: {},
  overline: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 12 },
  overlineDot: { width: 7, height: 7, borderRadius: "var(--radius-full)", background: "var(--brand)" },
  h1: { margin: 0, lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", textWrap: "balance" },
  sub: { margin: "12px 0 0", fontSize: 17, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "46ch" },
  // drill-чип — вторичное действие под hero, в той же 3D-тактильной грамматике, что
  // и bando-кнопки (своя violet-кромка), но в брендовом тинте — это особый хук, не
  // дженерик-кнопка. min-height + перенос: длинный label не клипается на 320px.
  drillChip: { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "8px 16px", marginBottom: 3, borderRadius: "var(--radius-md)", border: "2px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, lineHeight: 1.3, textAlign: "left", boxShadow: "0 3px 0 0 var(--brand-border)", cursor: "pointer", transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)" },
  // Подчинённый weak-type CTA при hero=recommended: тихая текст-ссылка, не дубль-чип.
  drillLink: { display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 44, padding: "4px 2px", background: "none", border: "none", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, textAlign: "left", cursor: "pointer" },
  firstNote: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.4, fontWeight: 600 },

  // Goal bar — target band + gap, inline-editable target select.
  goal: { marginTop: 20, display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  goalLab: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  goalSelectWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  goalSelect: { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface-inset)", padding: "4px 26px 4px 10px", cursor: "pointer", transition: "var(--transition-colors)" },
  goalChevron: { position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" },
  goalTrack: { position: "relative", display: "inline-block", width: 120, height: 8, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  goalFill: { position: "absolute", insetBlock: 0, left: 0, height: "100%", background: "var(--brand)", borderRadius: "var(--radius-full)" },
  goalGap: { fontSize: 13, fontWeight: 800, color: "var(--text-link)" },
  goalReached: { fontSize: 13, fontWeight: 800, color: "var(--success-text)" },
  goalHint: { fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },
  goalSaved: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800, color: "var(--success-text)" },
  goalError: { display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800, color: "var(--error-text)" },
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },

  // Hero — violet 3D-карта, белый ink (WCAG AA на brand, проверено: 4.63:1).
  hero: { flex: 1, background: "var(--brand)", borderRadius: "var(--radius-xl)", boxShadow: "0 5px 0 0 var(--brand-edge)", padding: 24, color: "var(--text-on-brand)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20, minHeight: 200 },
  heroEyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", marginBottom: 10 },
  heroTitle: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.015em", lineHeight: 1.2, textWrap: "balance" },
  heroSub: { fontSize: 13, marginTop: 8, lineHeight: 1.45 },
  rail: { height: 8, borderRadius: "var(--radius-full)", background: "color-mix(in oklab, white 25%, transparent)", overflow: "hidden", marginTop: 14 },
  heroMeta: { fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, marginTop: 12 },

  // Skills — sentence-case label (не uppercase-эйбрау)
  skillHead: { fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12 },
  filterToggle: { width: "100%", alignItems: "center", gap: 8, minHeight: 44, padding: "0 14px", marginBottom: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "var(--shadow-solid)" },
  skillCard: { display: "flex", flexDirection: "column", gap: 14, textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow-solid)", padding: 18, cursor: "pointer", fontFamily: "var(--font-ui)", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)" },
  skillTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  skillTile: { width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800 },
  skillName: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.015em", color: "var(--text-primary)" },
  skillCount: { fontSize: 13, color: "var(--text-muted)", marginTop: 3 },
  // marginTop:auto прижимает футер к низу карты — заполняет пустую нижнюю зону.
  skillFoot: { marginTop: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "var(--text-link)" },

  // BAND block — best band on a 0–9 rail with a target marker.
  bandBlock: { display: "flex", flexDirection: "column", gap: 6 },
  bandRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between" },
  bandOver: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-muted)" },
  bandVal: { fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700 },
  bandTrack: { position: "relative", height: 7, borderRadius: "var(--radius-full)", background: "var(--surface-inset)", overflow: "hidden" },
  bandFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "var(--radius-full)" },

  // Coming-soon strip (subordinated locked skills) — sentence-case label
  comingHead: { fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", margin: "0 0 12px" },
  coming: {},
  comingItem: { display: "inline-flex", alignItems: "center", gap: 10, minHeight: 48, padding: "8px 14px", borderRadius: "var(--radius-md)", border: "1.5px solid var(--border)", fontFamily: "var(--font-ui)", cursor: "pointer", transition: "var(--transition-colors)" },
  comingTile: { width: 30, height: 30, flex: "none", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800 },
  comingName: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" },

  // Question-type glossary (ESL help)
  glossList: { margin: 0, padding: "6px 14px 14px", display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border-subtle)" },
  glossTerm: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" },
  glossDef: { margin: "2px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" },

  // Catalog
  catalog: {},
  filterCol: {},
  listHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, outline: "none" },
  listTitle: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  sortWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  sortSelect: { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", padding: "6px 28px 6px 12px", cursor: "pointer", transition: "var(--transition-colors)" },
  activeEcho: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  echoLabel: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  echoChip: { display: "inline-flex", alignItems: "center", height: 28, padding: "0 11px", borderRadius: "var(--radius-full)", border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700 },
  showAll: { display: "inline-flex", alignItems: "center", gap: 5, padding: "0 13px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "var(--transition-colors)" },
  resultCount: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" },
  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  // Test row
  row: { display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "18px 20px", textDecoration: "none", color: "inherit", cursor: "pointer", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  rowTile: { width: 48, height: 48, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center" },
  rowPill: { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  rowMeta: { fontSize: 12, color: "var(--text-muted)" },
  rowTitle: { fontSize: 16, fontWeight: 700, color: "var(--text-primary)" },
  rowTypes: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  rowRight: { flex: "none", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  rowProgress: { fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" },
  rowDuration: { display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800 },
  lockFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 },

  // Locked panel
  locked: { display: "grid", gap: 36, marginTop: 16, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)", padding: 40 },
  bars: { display: "flex", flexDirection: "column", gap: 12, width: 150 },
  bar: { height: 20, borderRadius: "var(--radius-full)", transformOrigin: "left" },
  comingPill: { display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 700, marginBottom: 14 },
  lockedTitle: { margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)" },
  lockedDesc: { margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--text-secondary)", maxWidth: "56ch" },
  featureChip: { display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", background: "var(--surface-inset)", padding: "7px 13px", borderRadius: "var(--radius-full)" },
};
