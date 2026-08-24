"use client";

import { memo, useState } from "react";
import { Icon } from "@/components/core/icons";
import { countWords, parseChoiceCount, parseWordLimit } from "@/lib/exam/format-guard";
import { isAnswered } from "@/lib/exam/is-answered";
import { strategyHints } from "@/lib/exam/strategy-hints";
import type { RevealResult } from "../../../app/app/reading/[id]/practice-actions";
import type { ConfidenceLevel } from "@/lib/practice/confidence-calibration";

/**
 * PracticeAffordances — учебные аффордансы practice-режима ОДНОГО вопроса:
 * подсказка формата (P1), стратегия по типу (P2b), «Where to look?» ДО reveal
 * (P2b-2) и Check/Reveal/уверенность (P6/P7/P10/P14). Раньше жили инлайном в
 * QuestionBlock (ExamRunner); вынесены сюда, чтобы ОБА пути раннера рендерили один
 * и тот же набор без дублирования:
 *  - атомизированный список (QuestionBlock) — `showNumber={false}`, номер уже на
 *    карточке вопроса;
 *  - verbatim-панель (QuestionHtml, practice) — `showNumber` вешает заголовок
 *    «Question N» и `id="q-N"` (deep-link/навигатор скроллятся к нему), т.к. в
 *    оригинальной вёрстке отдельной карточки-якоря нет.
 *
 * Гейт practice применяет ВЫЗЫВАЮЩИЙ (QuestionBlock рендерит только в practice;
 * ExamRunner отдаёт renderAffordances только в practice) — компонент режим не
 * проверяет. Ключ не сериализуется: reveal/verdict приходят из server-actions
 * (owner ∧ in_progress ∧ mode='practice'), сам компонент к БД не ходит.
 */

/** Минимальная форма вопроса, нужная аффордансам (номер + тип + промпт + опции). */
interface AffordanceQuestion {
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
}

export const PracticeAffordances = memo(function PracticeAffordances({
  q,
  value,
  verdict,
  reveal,
  checkBusy,
  wrongTry,
  confidence,
  canLocate,
  onCheck,
  onReveal,
  onLocate,
  onConfidence,
  onWhereToLook,
  showNumber = false,
}: {
  q: AffordanceQuestion;
  value: string | string[];
  verdict: boolean | undefined;
  reveal: RevealResult | undefined;
  checkBusy: boolean;
  /** P14 — число неверных чеков этого вопроса. */
  wrongTry: number;
  /** P10 — метка уверенности (practice). undefined = не отмечено. */
  confidence?: ConfidenceLevel;
  /** P2b-2 — у вопроса есть локатор ДО reveal (сервер отгейтил qtype/наличие para). */
  canLocate: boolean;
  onCheck: (n: number, v: string | string[]) => void;
  onReveal: (n: number) => void;
  /** P2b-1 — локатор абзаца (reading). undefined на listening. */
  onLocate?: (para: string) => void;
  onConfidence: (n: number, level: ConfidenceLevel) => void;
  /** P2b-2 — запросить para ДО reveal (reading). undefined на listening. */
  onWhereToLook?: (n: number) => Promise<boolean>;
  /** verbatim-путь: показать заголовок «Question N» + повесить якорь id="q-N". */
  showNumber?: boolean;
}) {
  const inner = (
    <>
      {/* P1 — мягкая проверка формата (лимит слов / число выборов). */}
      <FormatHint q={q} value={value} />
      {/* P2b — сворачиваемая стратегия по типу вопроса (zero-key). */}
      <StrategyHint qtype={q.qtype} />
      {/* P2b-2 — локатор ДО reveal: reading (onWhereToLook задан), вопрос locatable,
          ещё не раскрыт. После reveal кнопка «Show in passage» живёт внутри
          PracticeCheck (P2b-1) → гейтим !reveal, чтобы не дублировать. */}
      {onWhereToLook && canLocate && !reveal && (
        <WhereToLook number={q.number} onWhereToLook={onWhereToLook} />
      )}
      {/* P6/P7/P14 — проверка ответа + вторая попытка + раскрытие ключа. */}
      <PracticeCheck
        number={q.number}
        value={value}
        verdict={verdict}
        reveal={reveal}
        busy={checkBusy}
        wrongTry={wrongTry}
        onCheck={onCheck}
        onReveal={onReveal}
        onLocate={onLocate}
        confidence={confidence}
        onConfidence={onConfidence}
      />
    </>
  );
  if (!showNumber) return inner;
  return (
    <div className="qa-item" id={`q-${q.number}`}>
      <div className="qa-num">Question {q.number}</div>
      {inner}
    </div>
  );
});

/**
 * FormatHint (P1) — практис-подсказка формата. Детерминированно (parseWordLimit /
 * parseChoiceCount по промпту) сигналит превышение лимита слов (completion) или числа
 * выборов (mcq_multi). Ключ НЕ трогается, ввод НЕ блокируется — только мягкий hint.
 * Возвращает null, когда формат не распознан или нарушения нет.
 */
const FormatHint = memo(function FormatHint({
  q,
  value,
}: {
  q: AffordanceQuestion;
  value: string | string[];
}) {
  const hasOptions = !!q.options && q.options.length > 0;

  // mcq_multi: превышено число выборов из промпта («Choose TWO»).
  if (hasOptions && q.qtype === "mcq_multi") {
    const want = parseChoiceCount(q.prompt_html);
    const picked = Array.isArray(value) ? value.length : value ? 1 : 0;
    if (want != null && picked > want) {
      return <FormatHintText text={`Choose only ${want} — you've selected ${picked}.`} />;
    }
    return null;
  }

  // completion: превышен лимит слов (числовые токены не считаются при AND/OR A NUMBER).
  if (!hasOptions) {
    const limit = parseWordLimit(q.prompt_html);
    const single = Array.isArray(value) ? (value[0] ?? "") : value;
    if (limit != null && countWords(single, limit.allowNumber) > limit.maxWords) {
      return (
        <FormatHintText
          text={`Use no more than ${limit.maxWords} word${limit.maxWords === 1 ? "" : "s"}${limit.allowNumber ? " and/or a number" : ""}.`}
        />
      );
    }
  }
  return null;
});

function FormatHintText({ text }: { text: string }) {
  return (
    <div className="exam-fmt-hint" role="status">
      <Icon name="info" size={15} strokeWidth={2.4} />
      <span>{text}</span>
    </div>
  );
}

/**
 * PracticeCheck (P6/P7) — под каждым отвеченным вопросом в practice: «Check» → инлайн
 * вердикт ✓/✗; затем «Show answer & why» → правильный ответ + объяснение + evidence.
 * Всё через server actions под гейтами (owner/in_progress/practice); клиент получает
 * лишь boolean, а при раскрытии — accept/explanation/evidence ОДНОГО вопроса.
 */
const PracticeCheck = memo(function PracticeCheck({
  number,
  value,
  verdict,
  reveal,
  busy,
  wrongTry,
  onCheck,
  onReveal,
  onLocate,
  confidence,
  onConfidence,
}: {
  number: number;
  value: string | string[];
  verdict: boolean | undefined;
  reveal: RevealResult | undefined;
  busy: boolean;
  /** P14 — число неверных чеков этого вопроса. */
  wrongTry: number;
  onCheck: (n: number, v: string | string[]) => void;
  onReveal: (n: number) => void;
  /** P2b-1 — локатор абзаца (reading); undefined на listening → кнопка не рендерится. */
  onLocate?: (para: string) => void;
  /** P10 — метка уверенности этого вопроса (practice). undefined = не отмечено. */
  confidence?: ConfidenceLevel;
  onConfidence: (n: number, level: ConfidenceLevel) => void;
}) {
  // «Check» появляется только когда вопрос отвечён (непустой ответ).
  if (!isAnswered(value)) return null;
  const decided = verdict !== undefined;
  // P14: reveal-ссылка — сразу при верном ответе ИЛИ после второго неверного чека.
  const canReveal = verdict === true || wrongTry >= 2;
  const para = reveal?.evidence?.para;
  return (
    <div className="exam-check">
      {!decided ? (
        <button type="button" className="exam-check-btn" disabled={busy} onClick={() => onCheck(number, value)}>
          <Icon name="check" size={15} strokeWidth={2.6} /> Check
        </button>
      ) : (
        <>
          <span className={`exam-verdict ${verdict ? "ok" : "no"}`}>
            <Icon name={verdict ? "check" : "x"} size={16} strokeWidth={2.8} />
            {verdict ? "Correct" : wrongTry >= 2 ? "Not quite" : "Not quite — try once more"}
          </span>
          {/* P14: после первого неверного — «Check again» (тот же или изменённый ответ),
              чтобы не было тупика, если ученик уверен в ответе и не меняет его. */}
          {verdict === false && wrongTry < 2 && (
            <button type="button" className="exam-check-btn" disabled={busy} onClick={() => onCheck(number, value)}>
              <Icon name="check" size={15} strokeWidth={2.6} /> Check again
            </button>
          )}
          {canReveal && !reveal && (
            <button type="button" className="exam-reveal-link" disabled={busy} onClick={() => onReveal(number)}>
              Show answer &amp; why
            </button>
          )}
        </>
      )}
      {reveal && (
        <div className="exam-reveal" role="region" aria-label={`Answer for question ${number}`}>
          <div className="exam-reveal-label">Answer</div>
          <div className="exam-reveal-answer">{reveal.accept.join(" / ") || "—"}</div>
          {reveal.explanation && <p className="exam-reveal-why">{reveal.explanation}</p>}
          {reveal.explanationRu && <RuExplanation text={reveal.explanationRu} />}
          {reveal.evidence?.snippet && (
            <div className="exam-reveal-ev">
              <span aria-hidden="true">📖</span>
              <span>{reveal.evidence.snippet}</span>
            </div>
          )}
          {/* P2b-1: reading → интерактивный локатор; без onLocate (listening) — прежний текст. */}
          {para &&
            (onLocate ? (
              <button type="button" className="exam-locate-btn" onClick={() => onLocate(para)}>
                <Icon name="map-pin" size={14} strokeWidth={2.4} /> Show in passage
              </button>
            ) : (
              <div className="exam-reveal-ev-para">{para}</div>
            ))}
        </div>
      )}
      {/* P10 — метка уверенности (опциональна). Тот же answered-гейт, что у Check
          (PracticeCheck выше вернул null для неотвеченных). Своя строка (flex-basis:100%). */}
      <div className="exam-conf" role="group" aria-label={`How sure were you about question ${number}?`}>
        <span className="exam-conf-label">How sure?</span>
        {(["low", "med", "high"] as const).map((lvl) => (
          <button
            key={lvl}
            type="button"
            className="exam-conf-opt"
            data-level={lvl}
            aria-pressed={confidence === lvl}
            data-active={confidence === lvl ? "" : undefined}
            onClick={() => onConfidence(number, lvl)}
          >
            {lvl === "low" ? "Unsure" : lvl === "med" ? "Maybe" : "Sure"}
          </button>
        ))}
      </div>
    </div>
  );
});

/**
 * RuExplanation (L1-слой, 0050) — свёрнутый по умолчанию RU-перевод английского
 * explanation внутри reveal. Свёрнут намеренно: EN-объяснение остаётся основной
 * методикой (IELTS сдаётся на английском), RU — страховочный слой для тех, кому
 * не хватает языка. Тот же паттерн тумблера, что StrategyHint ниже.
 */
function RuExplanation({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="exam-reveal-ru">
      <button
        type="button"
        className="exam-reveal-ru-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="exam-reveal-ru-badge">RU</span>
        {open ? "Hide" : "Explain in Russian"}
      </button>
      {open && <p className="exam-reveal-ru-text">{text}</p>}
    </div>
  );
}

/**
 * StrategyHint (P2b) — сворачиваемая стратегия по типу вопроса. Zero-key: контент
 * зависит ТОЛЬКО от qtype (strategyHints). Свёрнут по умолчанию; стиль — рядом с
 * FormatHint. Нет буллетов (неизвестный тип) → ничего не рендерим.
 */
const StrategyHint = memo(function StrategyHint({ qtype }: { qtype: string }) {
  const [open, setOpen] = useState(false);
  const bullets = strategyHints(qtype);
  if (bullets.length === 0) return null;
  return (
    <div className="exam-strategy">
      <button type="button" className="exam-strategy-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="lightbulb" size={15} strokeWidth={2.4} />
        <span>Strategy</span>
        <Icon name="chevron-down" size={15} strokeWidth={2.4} className="exam-strategy-chevron" data-open={open ? "" : undefined} />
      </button>
      {open && (
        <ul className="exam-strategy-list">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

/**
 * WhereToLook (P2b-2) — практис-кнопка «Where to look?» ДО reveal (reading). Тянет
 * para одного вопроса owner-path (тот же гейт, что reveal) и подсвечивает абзац в
 * пассаже (переиспользует локатор P2b-1). Сервер вернул null (гонка/ошибка/qtype-
 * гейт) → кнопку тихо прячем. Локальные hidden/busy живут в детях, чтобы пережить
 * ре-рендеры memo(QuestionBlock).
 */
const WhereToLook = memo(function WhereToLook({
  number,
  onWhereToLook,
}: {
  number: number;
  onWhereToLook: (n: number) => Promise<boolean>;
}) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (hidden) return null;
  return (
    <div className="exam-wtl">
      <button
        type="button"
        className="exam-locate-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onWhereToLook(number)
            .then((ok) => {
              if (!ok) setHidden(true);
            })
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="search" size={14} strokeWidth={2.4} /> Where to look?
      </button>
    </div>
  );
});
