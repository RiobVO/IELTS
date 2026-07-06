import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getReviewQueue, getVocabCatalog } from "@/lib/vocab/queries";
import { isUuid } from "@/lib/uuid";
import { AppShell } from "../../_AppShell";
import { ReviewSession } from "./ReviewSession";

export const dynamic = "force-dynamic";

/**
 * Экран одной сессии повторов (`/app/vocabulary/[deckId]`). uuid-гейт (мусор →
 * notFound, паритет с exam/[id]/page.tsx) + существование/тир дека — переиспользуем
 * getVocabCatalog (единственный источник locked-флага в готовом контракте; отдельного
 * getDeckById в data-слое нет, и добавлять его вне скоупа этой подзадачи). Локальный
 * дек ищем в каталоге по id: не найден → notFound (несуществующий/draft), locked →
 * redirect на /app/upgrade (прямая ссылка на чужой тир, как locked-тесты в Practice).
 * Очередь повторов — getReviewQueue; всё остальное состояние (caught-up/daily-cap/
 * активная сессия/итог) рендерит и ведёт клиентский ReviewSession.
 */
export default async function VocabDeckPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const user = await requireUser();
  const { deckId } = await params;
  if (!isUuid(deckId)) notFound();

  const [catalog, queue] = await Promise.all([
    getVocabCatalog(user.id),
    getReviewQueue(user.id, deckId, 20),
  ]);
  const deck = catalog.find((d) => d.id === deckId);
  if (!deck) notFound();
  if (deck.locked) redirect("/app/upgrade");

  return (
    <AppShell active="vocabulary">
      <ReviewSession
        deckTitle={deck.title}
        cards={queue.cards}
        dueCount={queue.dueCount}
        newRemainingToday={queue.newRemainingToday}
      />
    </AppShell>
  );
}
