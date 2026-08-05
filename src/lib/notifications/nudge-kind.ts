/**
 * Маппинг подтипа уведомления (`notification.kind`, 0046) в словарь ретеншен-
 * телеметрии (G2-3). Отдельный чистый модуль, потому что его читают обе стороны
 * метрики: продюсеры (кроны — знаменатель `nudge_sent`) и клик (`nudge_open`,
 * числитель), а строки должны совпадать буквально, иначе открываемость посчитается
 * по пустому пересечению.
 *
 * `null` = это не напоминание (бейдж, платёж и прочее): такие открытия в метрику
 * не идут — иначе числитель распухнет событиями, которых никто не рассылал.
 */
import type { NudgeKind } from "@/lib/analytics/events";

const NUDGE_KINDS: Record<string, NudgeKind> = {
  vocab_due_reminder: "vocab_due",
  streak_reminder: "streak",
  weekly_digest: "weekly_digest",
  reactivation: "reactivation",
};

export function toNudgeKind(kind: string | null | undefined): NudgeKind | null {
  if (!kind) return null;
  return NUDGE_KINDS[kind] ?? null;
}
