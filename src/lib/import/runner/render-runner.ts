import { injectPracticeAudioBridge, retargetBridgeOrigin } from "./bridge";
import { forceRunnerMode } from "./force-mode";
import { polyfillRunnerStorage } from "./runner-storage";
import { stripAnalysisLeak } from "./sanitize-runner";
import {
  injectProgressBridge,
  skinRunnerAudioDefer,
  skinRunnerAudioLabel,
  skinRunnerBrand,
  skinRunnerGate,
} from "./skin-runner";

/** Режим попытки, под который форсится раннер; null — прямой GET без in_progress-попытки. */
export type RunnerMode = "practice" | "mock";

/**
 * Единый read-time рендер runner-документа (вынесен из /app/exam/[id]/runner/route.ts,
 * чтобы инвариант «mock байт-в-байт» и practice-инъекция были покрыты тестом). Порядок
 * трансформов идентичен прежнему инлайну route:
 *
 * 1. polyfillRunnerStorage — in-memory Web-Storage (opaque origin, где нативный localStorage
 *    бросает). Нет <head> → null (fail-closed: раннер всё равно упал бы на первом localStorage).
 * 2. retargetBridgeOrigin — legacy-ряды с targetOrigin = window.location.origin ("null" в
 *    opaque origin) точечно на "*".
 * 3. injectProgressBridge — периодический автосейв (ielts-progress) внутрь bridge-IIFE.
 * 4. skinRunner* — bando-ребренд шапки, светлый аудио-гейт, отложенный аудио-стрим, тексты гейта.
 * 5. forceRunnerMode — внутренний Practice/Mock раннера по attempt.mode (+ mock-лимит из minutes);
 *    mode=null (прямой GET без попытки) — пропускаем, экзам-страница создаёт attempt до iframe.
 * 6. stripAnalysisLeak — read-time анти-утечка Inspera [data-analysis] (ПОСЛЕ всех трансформов:
 *    их regex-якоря работают по исходным байтам, не по реэмиссии).
 * 7. injectPracticeAudioBridge — ТОЛЬКО practice: внешний аудио-мост (seek/replay/rate/play/pause
 *    + события времени). Для mock не вызывается → выдача байт-в-байт прежняя.
 */
export function renderRunnerDocument(
  rawHtml: string,
  opts: { mode: RunnerMode | null; mockMinutes: number | null },
): string | null {
  const polyfilled = polyfillRunnerStorage(rawHtml);
  if (!polyfilled) return null;
  const scoped = retargetBridgeOrigin(polyfilled);
  const withProgress = injectProgressBridge(scoped);
  const skinned = skinRunnerAudioLabel(
    skinRunnerAudioDefer(skinRunnerBrand(skinRunnerGate(withProgress))),
  );
  const forced = opts.mode
    ? forceRunnerMode(skinned, opts.mode, opts.mode === "mock" ? opts.mockMinutes : null)
    : skinned;
  const safe = stripAnalysisLeak(forced);
  return opts.mode === "practice" ? injectPracticeAudioBridge(safe) : safe;
}
