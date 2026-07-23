import { and, eq, ne, notExists } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { attempt, contentItem } from "@/db/schema";
import { contentTag } from "@/lib/content/exam-content";

export type DeleteResult =
  | { ok: true; title: string }
  | { ok: false; reason: "not_found" | "published" | "has_attempts" };

/**
 * Физически удаляет content_item — ТОЛЬКО черновик (status != 'published') без
 * единой сдачи (attempt → ON DELETE CASCADE удалил бы попытки студентов вместе
 * с тестом, а это стирает их историю/прогресс — жёсткий отказ, не «мягкое»
 * ограничение). passage/question/answer_key каскадируются через contentItem.id
 * (FK ON DELETE CASCADE в schema.ts) — их отдельно чистить не нужно.
 *
 * MVCC-гонка (Codex-ревью, подтверждена): NOT EXISTS в одиночном DELETE читается
 * по снапшоту ЭТОГО стейтмента (READ COMMITTED). Незакоммиченный INSERT в attempt
 * — FK-триггер на content_item_id держит KEY SHARE, он НЕ блокирует наш anti-join
 * — невидим этому снапшоту: DELETE решает «attempts нет» ДО чужого коммита,
 * блокируется на row-локе строки content_item, а после коммита конкурента EPQ-
 * пересчёта anti-join НЕТ (сама строка content_item не менялась) — тест удаляется
 * вместе с только что созданной попыткой студента.
 *
 * Фикс — тот же приём, что startAttempt для profile (src/lib/exam/access.ts):
 * FOR UPDATE ПЕРВЫМ действием транзакции. FOR UPDATE конфликтует с KEY SHARE
 * FK-триггера INSERT attempt → мы дожидаемся коммита любого in-flight INSERT'а
 * (и блокируем новые до своего коммита); DELETE ниже — уже СЛЕДУЮЩИЙ стейтмент
 * той же транзакции, его снапшот под READ COMMITTED свежий и видит закоммиченный
 * attempt. Статус (published/not_found) тоже читаем под этим же локом — отдельный
 * диагностический select после DELETE больше не нужен. Лочим только content_item:
 * порядок локов repo (profile→content_item, apply-post-submit.ts/access.ts) не
 * нарушается, потому что profile здесь вообще не трогаем.
 */
export async function deleteDraftContentItem(id: string): Promise<DeleteResult> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: contentItem.status, title: contentItem.title })
      .from(contentItem)
      .where(eq(contentItem.id, id))
      .limit(1)
      .for("update");
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status === "published") return { ok: false as const, reason: "published" as const };

    // Guard остаётся ПРЯМО в WHERE (авторитетность на той же операции, что мутирует
    // строку) — теперь на свежем снапшоте следующего стейтмента, а не check-then-delete.
    const [deleted] = await tx
      .delete(contentItem)
      .where(
        and(
          eq(contentItem.id, id),
          ne(contentItem.status, "published"),
          notExists(tx.select({ one: attempt.id }).from(attempt).where(eq(attempt.contentItemId, contentItem.id))),
        ),
      )
      .returning({ title: contentItem.title });
    if (!deleted) return { ok: false as const, reason: "has_attempts" as const };
    return { ok: true as const, title: deleted.title };
  });

  if (result.ok) {
    // Вне транзакции/после коммита — каталог (content_item) + per-test кэши
    // exam/result (contentTag), зеркало publish.ts.
    revalidateTag("content_item");
    revalidateTag(contentTag(id));
  }
  return result;
}
