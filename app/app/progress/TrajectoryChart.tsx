"use client";

/**
 * Интерактивный график траектории. Серверная часть (OverviewPanel) считает ВСЮ
 * геометрию (домены, шкалы, координаты в системе viewBox) и передаёт готовые
 * числа/строки — здесь только рендер того же SVG, что рисовался инлайн раньше,
 * ПЛЮС слой наведения: вертикальный визир, подсвеченная точка и HTML-подсказка
 * с реальным band/датой/дельтой той точки, над которой курсор (или палец).
 *
 * Почему HTML-подсказка, а не SVG-текст: viewBox масштабируется под ширину
 * контейнера, и 9px-текст на узком телефоне схлопывается до ~4px. HTML-слой даёт
 * чёткий фиксированный кегль на любой ширине. Клавиатура (←/→/Home/End) двигает
 * активную точку — hover-only readout иначе недоступен с клавиатуры (WCAG).
 *
 * SSR/no-JS/reduced-motion: разметка уже финальна (линии нарисованы, значения на
 * месте) — интерактив лишь надстройка после гидрации, как OverviewMotion.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ChartPoint {
  x: number;
  y: number;
  band: number;
  dateMs: number;
  section: "reading" | "listening";
}

export interface TrajectoryChartProps {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  /** Облако СВИДЕТЕЛЬСТВ: каждый реальный мок. Маркеры + приёмник наведения — НЕ линия. */
  combined: ChartPoint[];
  /** Сквозная линия — band каждого мока подряд, хронологически (вариант 3
   *  «научный/точный»): прямые сегменты, без интерполяции. null только когда сдан
   *  один-единственный мок (линии из одной точки не бывает). */
  line: { path: string } | null;
  reading: { path: string } | null;
  listening: { path: string } | null;
  /** x-координаты всех моков — бледные вертикали сетки на каждой точке, отдельно
   *  от равномерных xTicks. */
  pointXs: number[];
  grid: { band: number; y: number }[];
  target: { y: number; band: number } | null;
  /** Цель ВНЕ окна обзора Y — бейдж у кромки плота вместо кламп-линии (см. коммент у SVG-линии target). */
  targetEdge: { band: number; above: boolean } | null;
  exam: { x: number; rightEdge: boolean } | null;
  forecast: { lastX: number; lastY: number; horizonX: number; projY: number } | null;
  /** Засечки/подписи оси X — равномерно по домену (4 на десктопе, 3 в портрете). */
  xTicks: { x: number; label: string }[];
  /** Пилюля текущего балла: band последнего мока. section — форма маркера «ты
   *  здесь» должна совпадать с формой секции (круг/ромб), а не всегда быть кругом. */
  latest: { x: number; y: number; band: number; section: "reading" | "listening" };
}

// Три РАЗНЫХ hue на белом плоте, каждый ≥3:1 (WCAG 1.4.11): reading — синий
// (--info-text, hue 232), listening — зелёный (--green-600, hue 158), combined
// несёт brand-фиолет (hue 292) отдельно. Раньше listening был фиолетовым и сливался
// с brand-линией Combined; развели по hue. Форма точек (круг/ромб) дублирует
// различение при дальтонизме, цвет — вторичный сигнал.
const SECTION_COLOR = { reading: "var(--info-text)", listening: "var(--green-600)" } as const;
// На ТЁМНОМ фоне тултипа тёмные цвета слились бы — точке-свотчу даём светлые
// варианты того же hue (текст рядом всё равно называет секцию явно).
const SECTION_DOT = { reading: "var(--sky-500)", listening: "var(--green-500)" } as const;
const SECTION_LABEL = { reading: "Reading", listening: "Listening" } as const;

function fmtFull(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Предыдущий мок ТОЙ ЖЕ секции. `combined` — облако свидетельств из двух разных тестов,
 * поэтому «предыдущая точка» и «предыдущий мок этого предмета» — разные вещи, и дельта
 * имеет смысл только для второго. Пинится overview.test.ts (инвариант combined).
 */
function prevSameSection(pts: ChartPoint[], i: number): ChartPoint | null {
  for (let j = i - 1; j >= 0; j--) if (pts[j].section === pts[i].section) return pts[j];
  return null;
}

export function TrajectoryChart({
  w, h, padL, padR, padT, padB,
  combined, line,
  reading, listening, pointXs, grid, target, targetEdge, exam, forecast,
  xTicks, latest,
}: TrajectoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  // Видимость сплит-серий: обе включены по умолчанию, тап по легенде гасит шумную
  // Reading/Listening, оставляя чистую Combined-линию (Combined не гасится). Стартуем
  // пустым (совпадает с SSR — избегаем hydration mismatch), затем подтягиваем выбор
  // из sessionStorage: пользователь, погасивший серию, не включает её заново каждую
  // навигацию/перезагрузку (тот же per-session-паттерн, что motion-гейт).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("ov-series-hidden");
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      // sessionStorage недоступен (private mode) — остаёмся на «всё видно».
    }
  }, []);
  const toggle = useCallback((s: string) => {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      try {
        sessionStorage.setItem("ov-series-hidden", JSON.stringify([...n]));
      } catch {
        // персист необязателен — тогл работает и без него.
      }
      return n;
    });
  }, []);

  // clientX → ближайшая точка по X (в системе viewBox через отношение rect).
  const pick = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || combined.length === 0) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const vx = ((clientX - rect.left) / rect.width) * w;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < combined.length; i++) {
        const d = Math.abs(combined[i].x - vx);
        if (d < bestD) { bestD = d; best = i; }
      }
      setActive(best);
    },
    [combined, w],
  );

  const onMove = useCallback((e: React.PointerEvent) => pick(e.clientX), [pick]);
  const onLeave = useCallback(() => setActive(null), []);

  // Тап вне графика гасит тултип. На тач `onPointerLeave` практически не приходит,
  // `Escape` есть только с клавиатуры, а сам тултип `pointer-events:none` — то есть
  // на телефоне визир с подсказкой висел до следующего тапа ПО ГРАФИКУ. Слушатель
  // живёт только пока точка активна; тап внутри svg отсеиваем — иначе он погасил бы
  // то, что сам только что выбрал (onPointerDown на svg и этот обработчик — один жест).
  useEffect(() => {
    if (active == null) return;
    const onDocDown = (e: PointerEvent) => {
      if (!svgRef.current?.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [active]);
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (combined.length === 0) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min((a ?? -1) + 1, combined.length - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max((a ?? combined.length) - 1, 0)); }
      else if (e.key === "Home") { e.preventDefault(); setActive(0); }
      else if (e.key === "End") { e.preventDefault(); setActive(combined.length - 1); }
      else if (e.key === "Escape") { setActive(null); }
    },
    [combined.length],
  );

  // Защита экспортируемого клиентского компонента: без точек рисовать нечего
  // (в текущем потоке TrajectoryHero не вызывает нас с пустым, но контракт
  // держим честным — ниже идёт доступ к combined[last]). Все хуки уже вызваны.
  if (combined.length === 0) return null;

  const act = active != null ? combined[active] : null;
  // Предыдущий мок ТОЙ ЖЕ секции, а не предыдущая точка смешанного облака. Раньше
  // тултип у Reading 3.5 писал «+1.5 vs previous mock», сравнивая с Listening 2.0 —
  // это не рост на 1.5 балла, это другой предмет.
  const prev = act && active != null ? prevSameSection(combined, active) : null;
  const delta = act && prev ? act.band - prev.band : null;
  // Тултип ставится РОВНО над точкой (left/top = координата точки в %); от overflow
  // спасаем не клампом центра (он рассинхронил бы стрелку), а сменой якоря: у левого
  // края бокс растёт вправо (стрелка у левого края), у правого — влево; по вертикали
  // у верха плота бокс флипается ВНИЗ, чтобы не наехать на заголовок карты.
  const pointXPct = act ? (act.x / w) * 100 : 0;
  const pointYPct = act ? (act.y / h) * 100 : 0;
  const tipEdge = pointXPct < 20 ? "left" : pointXPct > 80 ? "right" : "center";
  const tipBelow = pointYPct < 26;
  const tipTx = tipEdge === "left" ? "16px" : tipEdge === "right" ? "calc(-100% + 16px)" : "-50%";
  const tipTy = tipBelow ? "16px" : "calc(-100% - 14px)";
  // Тогл имеет смысл только когда нарисованы ОБЕ секционные линии: иначе он гасил бы
  // единственную линию. Секции, чьи точки на графике есть, но линии нет, всё равно
  // получают ключ — иначе форма маркера (○/◇) остаётся необъяснённой.
  const hasSplit = !!reading && !!listening;
  const sectionsPresent = (["reading", "listening"] as const).filter((s) =>
    combined.some((p) => p.section === s),
  );

  // Ключ «Target N» в легенде — короткий золотой свотч, когда цель нарисована (линией
  // внутри окна) ИЛИ бейджем у кромки (вне окна): обе формы — про одну и ту же цель.
  const targetLegendBand = target ? target.band : targetEdge ? targetEdge.band : null;

  // Пилюля текущего балла: НАД точкой `latest` (последний мок), с отступом от боковых
  // краёв. Точка НЕ обязательно справа-сверху — когда все моки свежие, а ось тянется
  // до экзамена, она сидит слева-внизу, и центрированная пилюля роняется на подпись
  // оси X.
  const lastLblXPct = (latest.x / w) * 100;
  const lastLblYPct = (latest.y / h) * 100;
  const latestTx = lastLblXPct < 18 ? "0%" : lastLblXPct > 82 ? "-100%" : "-50%";

  return (
    <>
    <div className="ov-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="auto"
        role="img"
        tabIndex={0}
        aria-label={`Band trajectory across ${combined.length} full ${combined.length === 1 ? "mock" : "mocks"}. Latest mock band ${latest.band.toFixed(1)}. Every mock is listed in the table after this chart.`}
        className="ov-chart-svg"
        style={{ display: "block", width: "100%", height: "auto", touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={onLeave}
        onBlur={onLeave}
        onKeyDown={onKey}
      >
        {/* Каркас графика (вариант «научный/точный»): сетка по обеим осям + рамка осей
            + засечки. Без него маркеры висели в белом поле — «точки», а не график:
            уровень точки читался только по бледной горизонтали, а положение во времени
            не читалось никак. Подписи вынесены в HTML-оверлей ниже (фикс-кегль на любой
            ширине; SVG-текст на 360px схлопывался до ~4.8px). */}
        {grid.map((g) => (
          <line key={g.band} x1={padL} x2={w - padR} y1={g.y} y2={g.y} stroke="var(--border-subtle)" strokeWidth={1} />
        ))}
        {/* Бледная вертикаль на КАЖДОЙ реальной точке (вариант 3 «научный/точный») —
            тоньше тоном, чем засечки xTicks ниже: нет отдельного более бледного
            border-токена, поэтому смешиваем border-subtle с поверхностью. */}
        {pointXs.map((x, i) => (
          <line key={`pt${i}`} x1={x} x2={x} y1={padT} y2={h - padB} stroke="color-mix(in oklab, var(--border-subtle) 55%, var(--surface))" strokeWidth={1} />
        ))}
        {xTicks.map((tk, i) => (
          <line key={i} x1={tk.x} x2={tk.x} y1={padT} y2={h - padB} stroke="var(--border-subtle)" strokeWidth={1} />
        ))}

        {/* Рамка осей — единственные СПЛОШНЫЕ линии хрома: они держат плот как объект. */}
        <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="var(--border-strong)" strokeWidth={1} />
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="var(--border-strong)" strokeWidth={1} />
        {grid.map((g) => (
          <line key={`ty${g.band}`} x1={padL - 4} x2={padL} y1={g.y} y2={g.y} stroke="var(--border-strong)" strokeWidth={1} />
        ))}
        {xTicks.map((tk, i) => (
          <line key={`tx${i}`} x1={tk.x} x2={tk.x} y1={h - padB} y2={h - padB + 4} stroke="var(--border-strong)" strokeWidth={1} />
        ))}

        {target && (
          // Линия рисуется ТОЛЬКО когда цель внутри окна обзора Y. Раньше цель вне окна
          // клампилась на кромку тем же приёмом, что и прогноз-стаб, — но клампнутая
          // линия читалась как «target почти достигнут», хотя реальный разрыв — в
          // несколько банд. Для такого случая цель несёт бейдж у кромки (targetEdge,
          // HTML-оверлей ниже), не линия. --warn-text (#975800, 5.69:1 на белом), не
          // сырой gold-500 (1.79:1): линия — значимый индикатор, ей хватило бы и 3:1
          // (1.4.11), но тот же токен красит подпись «Target N» рядом, а ей как
          // мелкому тексту нужны 4.5:1 (1.4.3). Пунктир отличает её от data-линий
          // независимо от цвета.
          <line x1={padL} x2={w - padR} y1={target.y} y2={target.y} stroke="var(--warn-text)" strokeWidth={1.5} strokeDasharray="5 4" />
        )}

        {exam && (
          <line x1={exam.x} x2={exam.x} y1={padT} y2={h - padB} stroke="var(--brand-active)" strokeWidth={1.5} strokeDasharray="3 3" />
        )}

        {forecast && (
          // Короткий пунктирный стаб-прогноз к правому краю окна (без большого конуса —
          // полный интервал в карточке Forecast). «Compact marker», как и договорились.
          <line
            x1={forecast.lastX} y1={forecast.lastY} x2={forecast.horizonX} y2={forecast.projY}
            stroke="var(--brand)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round"
          />
        )}

        {/* Reading/Listening — подчинённый пунктирный контекст, ПОД сквозной линией
            (вариант 3 «научный/точный»): комбинированная линия — главный сигнал
            графика, тренды секций лишь поясняют, из чего сложен каждый сегмент. Пока
            известна одна секция, сквозная линия совпадает с ней ровно — под сплошной
            2.2px пунктир 1.4px не виден целиком, и это ожидаемо (одна величина, один
            трек). Линии статичны с первого кадра (без draw-in): запись экрана на
            первой загрузке не должна ловить кадр без данных или с недорисованной
            линией. */}
        {reading && !hidden.has("reading") && (
          <path d={reading.path} fill="none" stroke={SECTION_COLOR.reading} strokeWidth={1.4}
            strokeDasharray="4 3" opacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {listening && !hidden.has("listening") && (
          <path d={listening.path} fill="none" stroke={SECTION_COLOR.listening} strokeWidth={1.4}
            strokeDasharray="4 3" opacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Сквозная линия ПОВЕРХ пунктиров — представление выбрано владельцем: каждый
            мок лежит на ОДНОЙ линии, без усреднения R/L в отдельную величину. Прямые
            сегменты (polyD, без интерполяции curve.ts) — провисания между данными
            невозможны, потому что кривизны между точками попросту нет. Дельта в
            тултипе всё равно считается в пределах СВОЕЙ секции (prevSameSection) —
            страховка от сравнения Reading напрямую с Listening только потому, что они
            лежат на одной линии по порядку сдачи. */}
        {line && (
          <path d={line.path} fill="none" stroke="var(--brand)" strokeWidth={2.2} strokeLinejoin="round" />
        )}

        {/* Маркер-кольцо на КАЖДОЙ реальной точке (заливка = surface, обводка = цвет
            секции) — данные читаются точно, даже когда линия гладкая. Секцию несёт НЕ
            только цвет: Reading — круг, Listening — ромб (различимо при дальтонизме,
            WCAG 1.4.1). Точки погашенной серии не рисуем. */}
        {combined.map((p, i) =>
          hidden.has(p.section) ? null : p.section === "listening" ? (
            <rect
              key={i}
              x={p.x - 3.2}
              y={p.y - 3.2}
              width={6.4}
              height={6.4}
              transform={`rotate(45 ${p.x} ${p.y})`}
              fill="var(--surface)"
              stroke={SECTION_COLOR[p.section]}
              strokeWidth={2}
            />
          ) : (
            <circle key={i} cx={p.x} cy={p.y} r={3.4} fill="var(--surface)" stroke={SECTION_COLOR[p.section]} strokeWidth={2} />
          ),
        )}

        {/* Визир + подсвеченная точка (только при наведении/фокусе). */}
        {act && (
          <g pointerEvents="none" className="ov-cross">
            <line x1={act.x} x2={act.x} y1={padT} y2={h - padB} stroke="var(--brand)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            <circle cx={act.x} cy={act.y} r={6} fill="none" stroke="var(--brand)" strokeWidth={2} />
            <circle cx={act.x} cy={act.y} r={3} fill="var(--brand)" />
          </g>
        )}

        {/* «Ты здесь» — на последнем моке (конец сквозной линии). Brand-заливка
            выделяет «сейчас», но форма остаётся формой секции: если последний мок —
            Listening, круг поверх ромба стёр бы канал формы (обязателен при
            дальтонизме, WCAG 1.4.1), и точка читалась бы как круг вопреки легенде. */}
        {latest.section === "listening" ? (
          <rect data-pop x={latest.x - 4.7} y={latest.y - 4.7} width={9.4} height={9.4}
            transform={`rotate(45 ${latest.x} ${latest.y})`}
            fill="var(--brand)" stroke="var(--surface)" strokeWidth={2}
            style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        ) : (
          <circle data-pop cx={latest.x} cy={latest.y} r={5}
            fill="var(--brand)" stroke="var(--surface)" strokeWidth={2}
            style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        )}

        {/* Прозрачная область-приёмник поверх — ловит курсор и между линиями. */}
        <rect x={padL} y={padT} width={w - padL - padR} height={h - padT - padB} fill="transparent" style={{ cursor: "crosshair" }} />
      </svg>

      {/* HTML-оверлей подписей: фикс-кегль (var(--text-2xs)) на любой ширине контейнера,
          позиционирование в % от того же viewBox (та же техника, что у тултипа). SVG-текст
          масштабировался вместе с viewBox и на узком телефоне падал до ~4.8px. */}
      <div className="ov-labels" aria-hidden="true">
        {grid.map((g) => (
          <span key={g.band} className="ov-lbl ov-lbl-grid" style={{ left: `${((padL - 7) / w) * 100}%`, top: `${(g.y / h) * 100}%` }}>
            {g.band}
          </span>
        ))}
        {target && (
          <span className="ov-lbl ov-lbl-target" style={{ left: `${((w - padR) / w) * 100}%`, top: `${(target.y / h) * 100}%` }}>
            Target {target.band}
          </span>
        )}
        {targetEdge && (
          // Бейдж, а не кламп-линия на кромке: клампнутая линия визуально сидела бы
          // рядом с данными и читалась как «target почти достигнут», хотя разрыв до
          // цели — несколько банд. Бейдж у угла плота честно говорит «цель за пределами
          // этого окна» стрелкой вверх/вниз, не привязываясь к масштабу оси.
          <span
            className="ov-lbl ov-lbl-target-edge"
            style={
              targetEdge.above
                ? { left: `${((w - padR) / w) * 100}%`, top: `${((padT + 6) / h) * 100}%`, transform: "translate(-100%, 0)" }
                : { left: `${((w - padR) / w) * 100}%`, top: `${((h - padB - 6) / h) * 100}%`, transform: "translate(-100%, -100%)" }
            }
          >
            Target {targetEdge.band} {targetEdge.above ? "↑" : "↓"}
          </span>
        )}
        {exam && (
          <span
            className="ov-lbl ov-lbl-exam"
            style={{ left: `${(exam.x / w) * 100}%`, top: `${((padT + 4) / h) * 100}%`, transform: exam.rightEdge ? "translate(-100%, 0)" : "translate(0, 0)", paddingInline: 4 }}
          >
            Exam
          </span>
        )}
        {!act && (
          <span
            className="ov-lbl ov-lbl-latest"
            style={{ left: `${lastLblXPct}%`, top: `${lastLblYPct}%`, transform: `translate(${latestTx}, calc(-100% - 10px))` }}
          >
            {latest.band.toFixed(1)}
          </span>
        )}
        {/* Крайние подписи прижимаем внутрь плота, средние центрируем по засечке —
            иначе первая/последняя вылезают за холст. */}
        {xTicks.map((tk, i) => (
          <span
            key={i}
            className="ov-lbl ov-lbl-axis"
            style={{
              left: `${(tk.x / w) * 100}%`,
              bottom: 0,
              transform: i === 0 ? "none" : i === xTicks.length - 1 ? "translate(-100%, 0)" : "translate(-50%, 0)",
            }}
          >
            {tk.label}
          </span>
        ))}
      </div>

      {act && (
        <div
          className={`ov-tip ov-tip-${tipEdge}${tipBelow ? " ov-tip-below" : ""}`}
          role="status"
          style={{ left: `${pointXPct}%`, top: `${pointYPct}%`, transform: `translate(${tipTx}, ${tipTy})` }}
        >
          <div className="ov-tip-date">{fmtFull(act.dateMs)}</div>
          <div className="ov-tip-band">
            <span className="ov-tip-dot" style={{ background: SECTION_DOT[act.section] }} />
            {SECTION_LABEL[act.section]} · <b>{act.band.toFixed(1)}</b>
          </div>
          {delta != null && (
            <div
              className="ov-tip-delta"
              style={{
                // Тултип тёмный (--surface-inverse) — тёмные *-text (для светлых
                // поверхностей) давали ~2.6:1. На тёмном берём светлые варианты.
                color:
                  delta > 0
                    ? "var(--green-500)"
                    : delta < 0
                      ? "color-mix(in oklab, var(--red-500) 72%, white)"
                      : "color-mix(in oklab, var(--surface-inverse-ink) 62%, transparent)",
              }}
            >
              {delta === 0
                ? `No change vs previous ${SECTION_LABEL[act.section]} mock`
                : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs previous ${SECTION_LABEL[act.section]} mock`}
            </div>
          )}
        </div>
      )}
    </div>

      {/* Таблица — авторитетное текстовое представление данных для скринридера.
          SVG остаётся `role="img"` с одной сводной подписью: стрелки по точкам мы
          даём зрячему клавиатурному пользователю, но `img` не widget-роль, и в
          browse-режиме NVDA/JAWS перехватят стрелки раньше компонента — обещать им
          ридаут было нельзя. Второй экземпляр графика (mobile/desktop) скрыт через
          display:none на обёртке, значит и его таблица из дерева доступности выпадает. */}
      <table className="ov-sr-only">
        <caption>Band by full mock, oldest first</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Section</th><th scope="col">Band</th></tr>
        </thead>
        <tbody>
          {combined.map((p, i) => (
            <tr key={i}>
              <td>{fmtFull(p.dateMs)}</td>
              <td>{SECTION_LABEL[p.section]}</td>
              <td>{p.band.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Легенда — сиблинг .ov-chart, не внутри, иначе % оверлея подписей считались
          бы от более высокого контейнера. Тогл R/L показываем ТОЛЬКО когда есть обе
          секции: при single-section combined совпадает со сплит-линией, гасить нечего,
          а note не должна называть несуществующую серию.

          Combined — КЛЮЧ легенды (bare-текст), R/L — bordered pill-кнопки. Раньше все
          трое несли общий `.ov-leg-item` и стояли в один ряд: три одинаковых на вид
          чипа, из которых кликаются два, а Combined читался как disabled-кнопка.
          Разделитель отбивает «ключ» от «контролов» — без лишней копирайт-подписи. */}
      <div className="ov-legend">
        {line && (
          <span className="ov-leg-key">
            <span className="ov-leg-swatch ov-leg-line" style={{ background: "var(--brand)" }} /> Combined
          </span>
        )}
        {hasSplit ? (
          <>
            {line && <span className="ov-leg-div" aria-hidden="true" />}
            <button type="button" className="ov-leg-item ov-leg-btn" aria-pressed={!hidden.has("reading")} aria-label={hidden.has("reading") ? "Show Reading line" : "Hide Reading line"} onClick={() => toggle("reading")}>
              <span className="ov-leg-swatch ov-leg-circle" style={{ background: SECTION_COLOR.reading }} /> Reading
            </button>
            <button type="button" className="ov-leg-item ov-leg-btn" aria-pressed={!hidden.has("listening")} aria-label={hidden.has("listening") ? "Show Listening line" : "Hide Listening line"} onClick={() => toggle("listening")}>
              <span className="ov-leg-swatch ov-leg-diamond" style={{ background: SECTION_COLOR.listening }} /> Listening
            </button>
          </>
        ) : (
          sectionsPresent.map((s) => (
            <span key={s} className="ov-leg-key">
              <span className={`ov-leg-swatch ov-leg-${s === "reading" ? "circle" : "diamond"}`} style={{ background: SECTION_COLOR[s] }} />{" "}
              {SECTION_LABEL[s]}
            </span>
          ))
        )}
        {targetLegendBand != null && (
          <span className="ov-leg-key">
            <span className="ov-leg-swatch ov-leg-line" style={{ background: "var(--warn-text)" }} /> Target {targetLegendBand}
          </span>
        )}
      </div>
      {line && (
        // Вторая фраза строится из фактически нарисованных линий (reading/listening
        // пропсы), не из предположения «всегда обе»: при одной секции или когда у
        // секции <2 точек линии нет, note раньше всё равно называл обе.
        <p className="ov-legend-note">
          Combined is your band across every full mock, in order.
          {reading && listening
            ? " Reading and Listening show each section's own trend; tap or click one to hide its line."
            : reading
              ? " Reading also shows the section's own trend."
              : listening
                ? " Listening also shows the section's own trend."
                : ""}
          {" Practice runs are training, not a measurement — only mock sittings plot here and feed the forecast."}
        </p>
      )}
    </>
  );
}
