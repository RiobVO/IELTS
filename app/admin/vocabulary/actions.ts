"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { vocabDeck } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  importVocabDeck,
  type VocabImportResult,
} from "@/lib/import/vocab/persist-vocab";
import { MAX_FILE_BYTES, VocabParseError } from "@/lib/import/vocab/parse-vocab";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERROR_MSG = 200; // потолок текста ошибки в redirect (query-string Location)

function fail(message: string): never {
  // Ограничиваем длину: e.message от парсера мог бы раздуть Location-header битым файлом.
  const safe = message.length > MAX_ERROR_MSG ? `${message.slice(0, MAX_ERROR_MSG)}…` : message;
  redirect(`/admin/vocabulary?error=${encodeURIComponent(safe)}`);
}

/**
 * Admin JSON-загрузка колоды (браузерный эквивалент `npm run import:vocab`).
 * Детерминированный parse → идемпотентный owner-persist (draft для нового дека).
 * Owner-only (requireAdmin); importVocabDeck пишет owner-путём (server-only).
 * Ошибки парсинга (VocabParseError) адресованы админу — показываем текст как есть.
 */
export async function uploadVocab(formData: FormData) {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    fail("Select a JSON deck file.");
  }
  // Отсекаем размер ПО БАЙТАМ (file.size) ДО .text(): иначе весь Blob буферизуется
  // в строку до проверки. Байтовый предел — тот же, что в парсере (defense in depth).
  if (file.size > MAX_FILE_BYTES) {
    fail(`File too large (${file.size} > ${MAX_FILE_BYTES} bytes).`);
  }
  const content = await file.text();

  let result: VocabImportResult;
  try {
    result = await importVocabDeck(content, file.name);
  } catch (e) {
    if (e instanceof VocabParseError) {
      fail(e.message);
    }
    console.error("admin uploadVocab failed", e);
    fail("Could not process the file (parsing or saving).");
  }

  revalidatePath("/admin/vocabulary");
  redirect(
    `/admin/vocabulary?${new URLSearchParams({
      inserted: String(result.inserted),
      updated: String(result.updated),
      total: String(result.totalCards),
    }).toString()}`,
  );
}

/**
 * Переключить статус колоды draft ↔ published (owner-only). Публикация делает
 * дек видимым студентам (RLS: политика vocab_deck_select_published). Отдельная
 * форма на строку — несёт только свой id. Ревалидируем только admin-страницу;
 * ревалидация студенческого каталога Vocabulary — зона vocab-модуля (кэш-тег/
 * dynamic там), сюда не связываемся.
 */
export async function setVocabStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID_RE.test(id) || (status !== "draft" && status !== "published")) {
    redirect("/admin/vocabulary");
  }
  await db.update(vocabDeck).set({ status }).where(eq(vocabDeck.id, id));
  revalidatePath("/admin/vocabulary");
  redirect(`/admin/vocabulary?done=${status === "published" ? "published" : "unpublished"}`);
}
