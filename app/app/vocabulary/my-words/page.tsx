import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { savedWord } from "@/db/schema";
import { AppShell } from "../../_AppShell";
import { MyWords, type SavedWordRow } from "./MyWords";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My words" };

/**
 * `/app/vocabulary/my-words` — личный словарь P11. Owner-path чтение своих saved_word
 * (Drizzle обходит RLS, но фильтр user_id стоит явно — как в остальных vocab-запросах),
 * отсортированных по сроку повтора. due/isNew выводятся на сервере из dueAt/lastReviewedAt,
 * SM-2-стейт клиенту не уходит (ему он не нужен — судья на сервере).
 */
export default async function MyWordsPage() {
  const user = await requireUser();
  const rows = await db
    .select({
      id: savedWord.id,
      word: savedWord.word,
      context: savedWord.context,
      dueAt: savedWord.dueAt,
      lastReviewedAt: savedWord.lastReviewedAt,
    })
    .from(savedWord)
    .where(eq(savedWord.userId, user.id))
    .orderBy(asc(savedWord.dueAt), asc(savedWord.word));

  const now = Date.now();
  const words: SavedWordRow[] = rows.map((r) => ({
    id: r.id,
    word: r.word,
    context: r.context,
    due: r.dueAt.getTime() <= now,
    isNew: r.lastReviewedAt == null,
  }));

  return (
    <AppShell active="vocabulary">
      <MyWords words={words} />
    </AppShell>
  );
}
