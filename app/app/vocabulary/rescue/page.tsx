import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getRescueQueue } from "@/lib/vocab/queries";
import { AppShell } from "../../_AppShell";
import { ReviewSession } from "../[deckId]/ReviewSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rescue review | bando" };

/** Rescue-сессия трудных слов: только уже начатые карты, без добора новых. */
export default async function VocabRescuePage() {
  const user = await requireUser();
  const cards = await getRescueQueue(user.id);
  if (cards.length === 0) redirect("/app/vocabulary");

  return (
    <AppShell active="vocabulary">
      <ReviewSession
        deckTitle="Rescue session"
        cards={cards}
        dueCount={cards.length}
        newRemainingToday={null}
        rescueSession
      />
    </AppShell>
  );
}
