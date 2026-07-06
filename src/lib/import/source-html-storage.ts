/**
 * Бэкап оригинального HTML импортируемого теста в Supabase Storage. Без этого
 * исходник не восстановить: runner-импорт вычищает ключи (sanitizeRunner) и
 * сохраняет только очищенный runner_html — необрезанный оригинал нигде не
 * остаётся (ни в БД, ни гарантированно на диске у импортёра).
 *
 * SERVER-ONLY: service-role клиент (owner, в обход RLS) — как uploadAudio.
 * Bucket `source-html` ПРИВАТНЫЙ (в отличие от `audio`/`writing-task1`): это
 * контент С ключами до вычистки, публичного доступа быть не должно. Путь
 * детерминирован от content_item.id (`${id}.html`) — отдельная колонка в БД
 * не нужна, восстановление всегда по id. upsert: реимпорт перезаписывает.
 */
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "source-html";

/** Идемпотентно создаёт приватный bucket, если его ещё нет. */
async function ensureBucket(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<void> {
  const { error: getErr } = await supabase.storage.getBucket(BUCKET);
  if (!getErr) return; // уже существует
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  });
  // Гонка с параллельным импортом, успевшим создать bucket первым, — не ошибка.
  if (createErr && !/exists/i.test(createErr.message)) throw createErr;
}

/**
 * Кладёт необрезанный исходный HTML (с ключами) по пути `${contentItemId}.html`.
 * Бросает на сбое — вызывающий (importRunner) решает, best-effort это или нет,
 * как и с uploadAudio.
 */
export async function uploadSourceHtml(
  contentItemId: string,
  rawHtml: string,
): Promise<void> {
  const supabase = createServiceClient();
  await ensureBucket(supabase);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${contentItemId}.html`, rawHtml, {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (error) throw error;
}
