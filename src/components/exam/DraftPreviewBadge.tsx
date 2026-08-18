import { Badge } from "@/components/core/Badge";

/**
 * F4 "Sit as student" — несъёмная плашка поверх экрана прохождения, когда админ
 * сидит в ЧЕРНОВИКЕ (a не то, что видят студенты — draft отрезан от них тремя
 * независимыми published-гейтами задолго до рендера этого компонента). Чисто
 * визуальное напоминание себе, не security-механизм.
 */
export function DraftPreviewBadge() {
  return (
    <div style={{ position: "fixed", top: 10, right: 10, zIndex: 100 }}>
      <Badge tone="warn">Draft preview</Badge>
    </div>
  );
}
