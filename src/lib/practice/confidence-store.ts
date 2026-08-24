import { parseConfidenceMap, type ConfidenceLevel } from "./confidence-calibration";

/**
 * Клиентское per-attempt хранилище P10-меток уверенности в localStorage
 * (`bando-confidence-<attemptId>`), читаемое островом калибровки на /result
 * (ResultCoach). Тот же ключ и та же форма {номер вопроса → уровень}, что пишет
 * атомизированный ExamRunner — вынесено сюда, чтобы iframe-поверхность listening-
 * practice писала метки идентично, без завязки на тяжёлый ExamRunner-модуль. Мусор
 * отбрасывает общий parseConfidenceMap; storage недоступен (private/quota) — метки
 * best-effort не сохраняются (как и в остальных practice-хранилищах).
 */
const CONFIDENCE_KEY = (attemptId: string) => `bando-confidence-${attemptId}`;

export function readConfidence(attemptId: string): Record<string, ConfidenceLevel> {
  if (typeof window === "undefined") return {};
  try {
    return parseConfidenceMap(localStorage.getItem(CONFIDENCE_KEY(attemptId)));
  } catch {
    return {}; // storage недоступен — метки просто не восстановим
  }
}

export function writeConfidence(
  attemptId: string,
  map: Record<string, ConfidenceLevel>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONFIDENCE_KEY(attemptId), JSON.stringify(map));
  } catch {
    /* storage недоступен (private/quota) — метки не сохранятся, не критично */
  }
}
