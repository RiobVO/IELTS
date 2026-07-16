"use client";

import { useState, useTransition, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/core/icons";
import { Badge } from "@/components/core/Badge";
import { Button } from "@/components/core/Button";
import { QuestionFilter } from "@/components/exam/QuestionFilter";
import { CatalogNotice } from "@/components/app/CatalogNotice";
import { Input } from "@/components/core/Input";
import { qtypeLabel, categoryLabel, qtypeDescription } from "@/lib/labels";
import type { SectionProgress } from "@/lib/practice/section-progress";
import { setTargetBand, joinContentWaitlist } from "./actions";

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
  /** Trial-лейн (§4.8): полный gated-тест, доступный Basic как единственный бесплатный. */
  trial: boolean;
  href: string;
  /** "Resume · 8 / 40" при живой in_progress-попытке, иначе null. */
  progress: string | null;
  /** "Done · 32 / 40" — лучший raw_score по submitted-попыткам, иначе null. */
  done: string | null;
  /** questionTypes пересекается со слабейшими типами юзера (weakSpots из page.tsx). */
  isWeakType: boolean;
  /** created_at моложе 7 дней (посчитано в page.tsx, не в кэше) — бейдж «New». */
  isNew: boolean;
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

/** Vocabulary row of the "Your progress" panel — slim view of VocabDueSummary
 *  (src/lib/vocab/summary.ts), just the three numbers the bar/stat need. */
interface VocabProgressStat {
  reviewedToday: number;
  goal: number;
  dueToday: number;
}

/** Предвыбор фильтра из query: секция + типы/категории + сорт. Значения уже
 *  провалидированы на сервере (page.tsx) против @/lib/labels и enum'а сорта. */
export interface InitialFilter {
  skill: Section | null;
  types: string[];
  cats: string[];
  sort: Sort;
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
  readingProgress,
  listeningProgress,
  vocabProgress,
  readingBand,
  listeningBand,
  targetBand,
  bestBand,
  writingEnabled = false,
  speakingEnabled = false,
  initialFilter,
  notice,
  telegramChannelUrl,
}: {
  tests: PracticeTest[];
  filterCategories: FilterOption[];
  filterTypes: FilterOption[];
  drillWeakest: DrillWeakest;
  hero: HeroData;
  /** Count line per live skill, e.g. "12 tests". */
  readingCount: string;
  listeningCount: string;
  /** "Done N of M · K left" — startable/attempted, секционный итог (не зависит от
   *  фильтров каталога ниже). */
  readingProgress: SectionProgress;
  listeningProgress: SectionProgress;
  /** Slim vocab summary (getVocabDueSummary) — feeds the "Your progress" panel's
   *  Vocabulary row, same numbers as the dashboard's VocabCard. */
  vocabProgress: VocabProgressStat;
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
  /** Student Telegram channel (TELEGRAM_CHANNEL_URL) — CTA on the empty-catalog
   *  funnel. null when unset => that CTA is simply not rendered. */
  telegramChannelUrl: string | null;
}) {
  const [selCats, setSelCats] = useState<string[]>(initialFilter?.cats ?? []);
  const [selTypes, setSelTypes] = useState<string[]>(initialFilter?.types ?? []);
  const [skill, setSkill] = useState<Skill | null>(initialFilter?.skill ?? null);
  const [sort, setSort] = useState<Sort>(initialFilter?.sort ?? "default");
  // Клиентский текстовый поиск по названию — массив тестов уже в памяти, дебаунс не нужен.
  const [query, setQuery] = useState("");
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

  // Состояние фильтра → URL (share/bookmark/refresh-safe). replaceState, не router:
  // URL отражает выбор, но без серверного ре-fetch (фильтрация остаётся клиентской).
  // Только reading/listening попадают в skill (locked-панель эфемерна). Сервер
  // (page.tsx) парсит types/cats/sort обратно при загрузке — round-trip замкнут.
  useEffect(() => {
    const params = new URLSearchParams();
    if (skill === "reading" || skill === "listening") params.set("skill", skill);
    if (selTypes.length) params.set("types", selTypes.join(","));
    if (selCats.length) params.set("cats", selCats.join(","));
    if (sort !== "default") params.set("sort", sort);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [skill, selCats, selTypes, sort]);

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
    setQuery("");
  };
  const selectSkill = (k: Skill) => {
    setSkill((s) => (s === k ? null : k));
    if (k === "reading" || k === "listening") revealCatalog();
  };
  // Goal module's "Drill" CTA — unlike selectSkill's toggle (used by the skill-
  // card grid below), this must be idempotent: clicking "Drill" while already
  // filtered to that skill should confirm/scroll, never remove the filter.
  const drillTo = (k: "reading" | "listening") => {
    setSkill(k);
    revealCatalog();
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
  // Каталог вообще пуст (контент-вайп, §12.3) — отличаем от «фильтр ничего не
  // нашёл»: та ветка ниже остаётся нетронутой, эта получает CTA-воронку вместо тупика.
  const catalogEmpty = tests.length === 0;

  const skillSection: Section | null = skill === "reading" || skill === "listening" ? skill : null;
  const lockedSkill = skill === "writing" || skill === "speaking" ? skill : null;

  const q = query.trim().toLowerCase();
  const filtered = tests.filter(
    (t) =>
      (!skillSection || t.section === skillSection) &&
      (selCats.length === 0 || selCats.includes(t.category)) &&
      (selTypes.length === 0 || t.questionTypes.some((x) => selTypes.includes(x))) &&
      (q === "" || t.title.toLowerCase().includes(q)),
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
  // Vocabulary из хаба убран (дубль: top-nav + модуль на дашборде уже ведут туда).
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
          <div className="pc-overline" style={S.overline}>
            <span style={S.overlineDot} />
            Practice library
          </div>
          <h1 className="pc-h1" style={S.h1}>Pick what to drill.</h1>
          <p style={S.sub}>Browse every Reading and Listening test, or filter straight to the question type you want to fix.</p>
          <GoalModule target={targetBand} best={bestBand} reading={readingProgress} listening={listeningProgress} vocab={vocabProgress} onDrill={drillTo} />
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
            // catalogEmpty: hero already reads "New tests are on the way" (buildHero
            // fallback) — this baseline-framing note would contradict it.
            hero.kind === "first" && !catalogEmpty && (
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
        <div style={S.skillHeadWrap}>
          <span style={S.skillHead}>Jump to a skill</span>
          {/* Контекст-хелп: что значит BAND на картах. Только когда band реально есть —
              новичков (всё «—») не грузим, их ведёт firstNote выше. */}
          {(readingBand != null || listeningBand != null) && (
            <span style={S.skillHint}>
              <Icon name="info" size={13} strokeWidth={2.5} style={{ color: "var(--text-muted)", flex: "none" }} />
              BAND is your best single test on each skill, not an official overall band.
            </span>
          )}
        </div>
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
        <div style={S.searchRow}>
          <Input
            icon="search"
            size="lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tests by title"
            aria-label="Search tests by title"
          />
        </div>
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
            {catalogEmpty ? (
              <CatalogEmptyFunnel
                telegramChannelUrl={telegramChannelUrl}
                writingEnabled={writingEnabled}
                speakingEnabled={speakingEnabled}
              />
            ) : filtered.length === 0 ? (
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

/* ── Goal module (light card: target pill + gap ring + status rows) ───────
   Owner's final call after a dark aurora-glass round read "too purple, not
   warm/friendly" — back to the page's normal light surface tokens; violet is
   an ACCENT only (ring fill, CTA, chip), matching a mock-up: ring + an
   encouraging headline + three soft status rows, one carrying a CTA where
   work remains. Target selector keeps the exact state machine every earlier
   round built up (optimistic set → serialized async transition →
   setTargetBand → Saved/Error aria-live) — only the chrome changes, pill-
   sized now instead of a giant number.

   Hero zone (gap ring + headline/subcopy) was cut on prod feedback 2026-07-16
   ("too big" — it was also stretching the neighboring resume card via grid-
   stretch on the empty violet column). Header is now just the pill + a
   "Reached ✓"/"N% to go" readout; rows are unchanged. */
function GoalModule({
  target,
  best,
  reading,
  listening,
  vocab,
  onDrill,
}: {
  target: number | null;
  best: number | null;
  reading: SectionProgress;
  listening: SectionProgress;
  vocab: VocabProgressStat;
  /** Reading/Listening row CTA — PracticeCatalog's drillTo: filters to the
   *  skill (idempotent, unlike the skill-card grid's toggle) + reveals the
   *  test list below. */
  onDrill: (section: "reading" | "listening") => void;
}) {
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

  const change = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Serialize saves: while one is in flight, ignore re-entrant changes instead
    // of letting a second request race the first. Without this, an out-of-order
    // resolution (older request settles after a newer one already applied) could
    // roll back over a value the user already confirmed — the closure below
    // captures the RIGHT `prev` for its own call, but two overlapping calls each
    // "correct" per their own view, and the net result depends on arrival order.
    // Blocking re-entry means there's only ever one request in flight, so that
    // ambiguity can't occur.
    if (pending) return;
    const next = Number(e.target.value);
    const prev = value;
    setValue(next); // optimistic
    setError(false);
    // Async transition (React 19): startTransition awaits the passed function,
    // so `pending` now spans the whole request instead of flipping back to false
    // as soon as the synchronous part of the callback returns (which is what
    // happened with `startTransition(() => { fn().then(...) })` — the .then/.catch
    // ran outside the transition, `pending` lied about being done immediately).
    startTransition(async () => {
      try {
        await setTargetBand(next.toFixed(1));
        setSaved(true);
        setStatus(`Target band set to ${next.toFixed(1)}`);
      } catch {
        setValue(prev); // откат оптимизма — не оставляем непросохранённое значение
        setError(true);
        setStatus("Couldn't save your target — please try again");
      }
    });
  };

  // Saved/Error замещают "Reached ✓"/"N% to go" транзиентно — не плодим лишний элемент.
  const tail = error ? (
    <span style={S.pgError}>Couldn&apos;t save — try again</span>
  ) : saved ? (
    <span style={S.pgSaved} className="pc-goalsaved">
      <Icon name="check" size={13} strokeWidth={3} /> Saved
    </span>
  ) : null;

  // Target unset (onboarding normally guarantees it) — the pill/select needs a
  // real value, so both the pill and the reached/gap readout are skipped; the
  // rows below render regardless (they don't depend on a target).
  const targetValue = value;
  const reached = targetValue != null && best != null && best >= targetValue;
  const pctToGo =
    targetValue != null && best != null && best < targetValue
      ? Math.round((1 - best / targetValue) * 100)
      : null;

  return (
    <div className="pg-card" style={S.pgCard}>
      <div className="pg-head">
        {targetValue != null && (
          <span className="pg-goalpill" style={S.pgGoalPill}>
            <span style={S.pgGoalPillLab}>Goal · Band</span>
            <span style={S.pgSelectWrap} className="pg-selectwrap">
              <select
                aria-label="Target band"
                className="pg-select"
                value={targetValue.toFixed(1)}
                onChange={change}
                aria-busy={pending}
                style={S.pgSelect}
              >
                {BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <Icon name="chevron-down" size={14} strokeWidth={2.5} style={S.pgChevron} />
            </span>
          </span>
        )}
        {/* No ring anymore (cut 2026-07-16 — too big, stretched the neighboring
            resume card) — "reached" now gets a minimal text readout instead of
            losing the signal entirely. */}
        {tail ?? (reached ? (
          <span style={S.pgReachedTag}>Reached ✓</span>
        ) : (
          pctToGo != null && <span style={S.pgPctToGo}>{pctToGo}% to go</span>
        ))}
        <span role="status" aria-live="polite" style={S.srOnly}>{status}</span>
      </div>

      <div className="pg-rows">
        <SectionRow tone="reading" label="Reading" progress={reading} onDrill={onDrill} />
        <SectionRow tone="listening" label="Listening" progress={listening} onDrill={onDrill} />
        <VocabRow vocab={vocab} />
      </div>
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

/* ── Status rows (Reading / Listening / Vocabulary) ────────────────────────
   Soft tinted pills, not bars: success tint when nothing's left, a neutral
   row + "Drill"/"Review" CTA where work remains, muted when there's simply
   nothing to show yet. Diamonds and neon tubes from the previous round are
   gone entirely — this design carries no per-test detail, only the aggregate
   + a way in. The R/L/V chip is decorative (aria-hidden); the skill name is
   now plain visible text right next to it, so it doubles as the accessible
   name with no sr-only span needed (earlier rounds hid the word and relied on
   sr-only — simpler now that the word itself is on-screen). */
const PROGRESS_TILE: Record<"reading" | "listening" | "vocab", { bg: string; fg: string; letter: string }> = {
  reading: { bg: "var(--brand-subtle)", fg: "var(--text-link)", letter: "R" },
  listening: { bg: "var(--info-subtle)", fg: "var(--info-text)", letter: "L" },
  vocab: { bg: "var(--success-subtle)", fg: "var(--success-text)", letter: "V" },
};

const ROW_TONE: Record<"success" | "warn" | "neutral" | "muted", { bg: string; fg: string; bd: string }> = {
  success: { bg: "var(--success-subtle)", fg: "var(--success-text)", bd: "color-mix(in oklab, var(--success) 35%, transparent)" },
  warn: { bg: "var(--warn-subtle)", fg: "var(--warn-text)", bd: "color-mix(in oklab, var(--warn) 35%, transparent)" },
  neutral: { bg: "var(--surface-inset)", fg: "var(--text-secondary)", bd: "var(--border)" },
  muted: { bg: "var(--surface-inset)", fg: "var(--text-muted)", bd: "var(--border-subtle)" },
};

function StatusRow({
  tone,
  chipTone,
  label,
  status,
  cta,
}: {
  tone: keyof typeof ROW_TONE;
  chipTone: "reading" | "listening" | "vocab";
  label: string;
  status: string;
  cta?: ReactNode;
}) {
  const t = ROW_TONE[tone];
  const chip = PROGRESS_TILE[chipTone];
  return (
    <div className="pg-row" style={{ background: t.bg, borderColor: t.bd }}>
      <span aria-hidden="true" style={{ ...S.pgChip, background: chip.bg, color: chip.fg }}>{chip.letter}</span>
      <span style={S.pgRowLabel}>{label}</span>
      <span style={{ ...S.pgRowStatus, color: t.fg }}>{status}</span>
      {cta}
    </div>
  );
}

function SectionRow({
  tone,
  label,
  progress,
  onDrill,
}: {
  tone: "reading" | "listening";
  label: string;
  progress: SectionProgress;
  onDrill: (section: "reading" | "listening") => void;
}) {
  const { total, left } = progress;
  if (total === 0) {
    return <StatusRow tone="muted" chipTone={tone} label={label} status="New tests soon" />;
  }
  if (left === 0) {
    return <StatusRow tone="success" chipTone={tone} label={label} status="0 left ✓" />;
  }
  return (
    <StatusRow
      tone="neutral"
      chipTone={tone}
      label={label}
      status={`${left} left`}
      cta={
        <Button variant="secondary" size="sm" trailingIcon="arrow-right" onClick={() => onDrill(tone)}>
          Drill
        </Button>
      }
    />
  );
}

function VocabRow({ vocab }: { vocab: VocabProgressStat }) {
  if (vocab.dueToday > 0) {
    return (
      <StatusRow
        tone="warn"
        chipTone="vocab"
        label="Vocabulary"
        status={`${vocab.dueToday} due`}
        cta={
          <Button variant="secondary" size="sm" trailingIcon="arrow-right" href="/app/vocabulary">
            Review
          </Button>
        }
      />
    );
  }
  // Nothing due right now, but the goal isn't met either — "All done" would
  // overclaim (goal ≠ due).
  if (vocab.reviewedToday >= vocab.goal) {
    return <StatusRow tone="success" chipTone="vocab" label="Vocabulary" status="All done today ✓" />;
  }
  return <StatusRow tone="neutral" chipTone="vocab" label="Vocabulary" status="No reviews due" />;
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
      {/* Band-рейл — только у фильтр-карт (твоё стояние по скиллу). Nav-карты (live
          W/S) — другой вид: ведут в отдельный инструмент, band там не к месту. Вместе
          с диагональной стрелкой это разводит «фильтр на месте» и «переход». */}
      {!href && <SkillBand band={band} target={targetBand ?? 7} base={p.base} ink={p.ink} />}
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
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 4, gap: 9, marginBottom: 4 }}>
          <span className="pc-row-pill" style={{ ...S.rowPill, color: sec.tileFg, background: sec.tileBg }}>{sec.label}</span>
          <span style={S.rowMeta}>{cat(t.category)} · {t.questionCount} Q</span>
          {t.trial && <Badge tone="brand">Free trial</Badge>}
          {t.isWeakType && <Badge tone="warn">Weak spot</Badge>}
          {t.isNew && <Badge tone="success">New</Badge>}
        </div>
        <div style={S.rowTitle}>{t.title}</div>
        {typesLabel && <div style={S.rowTypes}>{typesLabel}</div>}
      </div>
      <div style={S.rowRight} className="pc-rowright">
        {/* Живая попытка → Resume; иначе лучший прошлый результат → Done; иначе для
            непройденного — длительность (продаёт тест), не опаковый «—» (скринридер
            читает его как «em dash»). */}
        {t.progress ? (
          <span style={S.rowProgress}>{t.progress}</span>
        ) : t.done ? (
          <span style={S.rowDone}>{t.done}</span>
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

/* ── Catalog empty-state funnel (content-wipe, §12.3) ─────────────────────
   Whole catalog empty (not just a filter miss) — convert instead of dead-ending:
   honest "refreshing" framing, two soft CTAs (Telegram channel / waitlist), and
   live-feature cards so the visit isn't wasted. */
function CatalogEmptyFunnel({
  telegramChannelUrl,
  writingEnabled,
  speakingEnabled,
}: {
  telegramChannelUrl: string | null;
  writingEnabled: boolean;
  speakingEnabled: boolean;
}) {
  const cards: { href: string; icon: IconName; name: string; desc: string }[] = [
    { href: "/app/vocabulary", icon: "graduation-cap", name: "Vocabulary", desc: "Grow your word bank with spaced repetition." },
    { href: "/app/practice/mistakes", icon: "target", name: "Mistake review", desc: "Drill the questions you've gotten wrong before." },
    ...(writingEnabled ? [{ href: "/app/writing", icon: "pen-line" as IconName, name: "Writing", desc: "Get Task 1 & 2 scored, with a model rewrite." }] : []),
    ...(speakingEnabled ? [{ href: "/app/speaking", icon: "mic" as IconName, name: "Speaking", desc: "Record Part 2 and get scored on the spot." }] : []),
  ];
  return (
    <div style={S.catalogEmpty}>
      <span style={S.catalogEmptyIcon}>
        <Icon name="sparkles" size={26} strokeWidth={2} />
      </span>
      <div style={S.catalogEmptyTitle}>New tests are on the way</div>
      <p style={S.catalogEmptySub}>
        The Reading and Listening library is being refreshed — check back soon, or get
        pinged the moment fresh tests land.
      </p>
      <div className="pc-empty-ctas" style={S.catalogEmptyCtas}>
        {telegramChannelUrl && (
          <Button variant="secondary" trailingIcon="arrow-up-right" href={telegramChannelUrl}>
            Join our Telegram channel
          </Button>
        )}
        <ContentWaitlistCta />
      </div>
      <div style={S.catalogEmptyMeanwhile}>
        <span style={S.catalogEmptyMeanwhileLabel}>Meanwhile, keep your streak alive</span>
        <div className="pc-empty-cards" style={S.catalogEmptyCards}>
          {cards.map((c) => (
            <Link key={c.href} href={c.href} className="pc-empty-card" style={S.catalogEmptyCard}>
              <span style={S.catalogEmptyCardIcon}>
                <Icon name={c.icon} size={18} strokeWidth={2.2} />
              </span>
              <span>
                <span style={S.catalogEmptyCardName}>{c.name}</span>
                <span style={S.catalogEmptyCardDesc}>{c.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Waitlist CTA — same optimistic pattern as WaitlistCta in app/upgrade/PricingScreen.tsx:
 * flip to "joined" on click, fire the server action best-effort (analytics isn't
 * critical, and there's nothing sensible to roll back to on failure).
 */
function ContentWaitlistCta() {
  const [joined, setJoined] = useState(false);
  return (
    <Button
      variant={joined ? "secondary" : "primary"}
      icon={joined ? "circle-check" : "bell"}
      disabled={joined}
      onClick={() => {
        if (joined) return;
        setJoined(true);
        void joinContentWaitlist().catch(() => {});
      }}
    >
      {joined ? "You're on the list" : "Notify me when new tests land"}
    </Button>
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
.pc-empty-cards{grid-template-columns:1fr}
.pc-empty-card:hover{border-color:var(--brand-border)!important;background:var(--surface-hover)!important}
.pc-row:hover{transform:translateY(-2px);border-color:var(--brand-border)!important;box-shadow:var(--shadow-solid-lg)}
/* На телефоне ряд теста стекается: действие (Resume/Start) уходит футер-баром на всю
   ширину под заголовок — иначе оно жмёт длинный тайтл в узкую колонку (рвётся на 8-9 строк).
   !important бьёт inline flexDirection/alignItems/textAlign у S.rowRight (media их иначе не победит). */
@media(max-width:560px){
  .pc-row{flex-wrap:wrap;row-gap:14px}
  .pc-rowright{flex-basis:100%!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;text-align:left!important}
}
.pc-drill:hover{border-color:var(--brand)!important}
.pc-drill:active{transform:translateY(3px);box-shadow:none!important}
.pc-drilllink:hover{text-decoration:underline}
/* Goal module — light card, compact: .pg-head is just the target pill + a
   "Reached ✓"/"N% to go" readout (hero ring was cut 2026-07-16 — too big). */
.pg-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pg-selectwrap:hover select{opacity:.85}
/* Native OPEN popup is a system menu that ignores most inline styling — only
   color/background-color on <option> carry through (inconsistently, but this
   is the standard mitigation). Without it some platforms render white-on-white. */
.pg-select option{color:var(--text-primary);background:var(--surface)}
.pg-rows{display:flex;flex-direction:column;gap:10px}
.pg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:8px;padding:12px 14px;border-radius:var(--radius-md);border:1.5px solid transparent;transition:var(--transition-colors)}
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
  .pc-empty-cards{grid-template-columns:repeat(2,1fr)}
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
@media (pointer:coarse){.pc-showall{min-height:44px}.pc-goalsel{min-height:44px}.pg-select{min-height:44px}}
/* iOS зумит вьюпорт при фокусе поля с font-size <16px. */
@media (max-width:430px){.pc-goalsel{font-size:16px!important}.pg-select{font-size:16px!important}}
/* Микро-текст: overline-эйбрау и R/L-пилюля в строке теста — смысловые лейблы → 12px. */
@media (max-width:430px){.pc-overline{font-size:12px!important}.pc-row-pill{font-size:12px!important}}
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

  // goalChevron — shared with the catalog's "Sort tests" select below (.pc-goalsel/
  // .pc-goalselect), kept here even though GoalBar's own pill is gone.
  goalChevron: { position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)" },
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 },

  // Hero — violet 3D-карта, белый ink (WCAG AA на brand, проверено: 4.63:1).
  hero: { flex: 1, background: "var(--brand)", borderRadius: "var(--radius-xl)", boxShadow: "0 5px 0 0 var(--brand-edge)", padding: 24, color: "var(--text-on-brand)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20, minHeight: 200 },
  heroEyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", marginBottom: 10 },
  heroTitle: { fontSize: 20, fontWeight: 700, lineHeight: 1.2, textWrap: "balance" },
  heroSub: { fontSize: 13, marginTop: 8, lineHeight: 1.45 },
  rail: { height: 8, borderRadius: "var(--radius-full)", background: "color-mix(in oklab, white 25%, transparent)", overflow: "hidden", marginTop: 14 },
  heroMeta: { fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, marginTop: 12 },

  // Goal module — light card (target pill + status rows only — the gap ring
  // was cut 2026-07-16, too big, was stretching the neighboring resume card
  // via grid-stretch on the empty column). Moderate padding/gap, close to the
  // neighboring skill-cards' own footprint — final height ≈ pill + 3 rows.
  // Violet is an accent only (pill fill, chip, CTA), not a theme.
  pgCard: { display: "flex", flexDirection: "column", gap: 14, marginTop: 20, padding: 18, borderRadius: "var(--radius-xl)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-solid)" },
  pgGoalPill: { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 14px", borderRadius: "var(--radius-full)", background: "var(--brand-subtle)", border: "1px solid var(--brand-border)" },
  pgGoalPillLab: { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", color: "var(--text-link)" },
  pgSelectWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  pgSelect: { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, color: "var(--text-link)", background: "transparent", border: "none", padding: "0 20px 0 4px", cursor: "pointer" },
  pgChevron: { position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-link)" },
  pgPctToGo: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  // Reached readout replaces the old ring's success-tone fill/checkmark —
  // same success token as the row tint (ROW_TONE.success.fg), no new colour.
  pgReachedTag: { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--success-text)" },
  pgSaved: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--success-text)" },
  pgError: { display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700, color: "var(--error-text)" },

  // Status rows — chip colour is per-skill (PROGRESS_TILE), row bg/text colour
  // is per-status (ROW_TONE, computed at the call site).
  pgChip: { width: 18, height: 18, flex: "none", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700 },
  pgRowLabel: { fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, letterSpacing: "0.01em", color: "var(--text-primary)" },
  pgRowStatus: { fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", marginLeft: "auto" },

  // Skills — sentence-case label (не uppercase-эйбрау) + опц. контекст-хелп про BAND
  skillHeadWrap: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 },
  skillHead: { fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" },
  skillHint: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, lineHeight: 1.4, fontWeight: 600, color: "var(--text-muted)" },
  filterToggle: { width: "100%", alignItems: "center", gap: 8, minHeight: 44, padding: "0 14px", marginBottom: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "var(--shadow-solid)" },
  skillCard: { display: "flex", flexDirection: "column", gap: 14, textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow-solid)", padding: 18, cursor: "pointer", fontFamily: "var(--font-ui)", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard)" },
  skillTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  skillTile: { width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", fontSize: 16, fontWeight: 700 },
  skillName: { fontSize: 18, fontWeight: 700, color: "var(--text-primary)" },
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
  comingTile: { width: 30, height: 30, flex: "none", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700 },
  comingName: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" },

  // Question-type glossary (ESL help)
  glossList: { margin: 0, padding: "6px 14px 14px", display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border-subtle)" },
  glossTerm: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" },
  glossDef: { margin: "2px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" },

  // Catalog
  searchRow: { marginBottom: 20 },
  catalog: {},
  filterCol: {},
  listHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, outline: "none" },
  listTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-primary)" },
  sortWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
  sortSelect: { appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 13, color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", padding: "6px 28px 6px 12px", cursor: "pointer", transition: "var(--transition-colors)" },
  activeEcho: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  echoLabel: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" },
  echoChip: { display: "inline-flex", alignItems: "center", height: 28, padding: "0 11px", borderRadius: "var(--radius-full)", border: "1px solid var(--brand-border)", background: "var(--brand-subtle)", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700 },
  showAll: { display: "inline-flex", alignItems: "center", gap: 5, padding: "0 13px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "var(--transition-colors)" },
  resultCount: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" },
  empty: { padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 14, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)" },

  // Catalog empty-state funnel (whole catalog empty — §12.3 content-wipe)
  catalogEmpty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "44px 24px", textAlign: "center", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)" },
  catalogEmptyIcon: { display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--text-link)", marginBottom: 14 },
  catalogEmptyTitle: { fontFamily: "var(--font-ui)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)" },
  catalogEmptySub: { margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--text-muted)", maxWidth: "48ch" },
  catalogEmptyCtas: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 22 },
  catalogEmptyMeanwhile: { marginTop: 36, width: "100%", borderTop: "1px solid var(--border-subtle)", paddingTop: 26 },
  catalogEmptyMeanwhileLabel: { display: "block", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 14 },
  catalogEmptyCards: { display: "grid", gap: 12 },
  catalogEmptyCard: { display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", padding: "14px 16px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", color: "inherit", textDecoration: "none", transition: "var(--transition-colors)" },
  catalogEmptyCardIcon: { flex: "none", display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--brand-subtle)", color: "var(--text-link)" },
  catalogEmptyCardName: { display: "block", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" },
  catalogEmptyCardDesc: { display: "block", fontSize: 12.5, lineHeight: 1.4, color: "var(--text-muted)", marginTop: 2 },

  // Test row
  row: { display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "18px 20px", textDecoration: "none", color: "inherit", cursor: "pointer", transition: "transform var(--duration-base) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)" },
  rowTile: { width: 48, height: 48, flex: "none", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center" },
  rowPill: { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", padding: "2px 8px", borderRadius: "var(--radius-full)" },
  rowMeta: { fontSize: 12, color: "var(--text-muted)" },
  rowTitle: { fontSize: 16, fontWeight: 700, color: "var(--text-primary)" },
  rowTypes: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  rowRight: { flex: "none", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 },
  rowProgress: { fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" },
  rowDone: { fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--success-text)" },
  rowDuration: { display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },
  startFoot: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 },
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
