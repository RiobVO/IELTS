/**
 * Загрузка аудио Listening в Supabase Storage. SERVER-ONLY: использует
 * service-role ключ (owner, в обход RLS) — как и весь импорт. Bucket `audio`
 * PUBLIC, поэтому отдаём прямой public URL; signed-доступ (anti-leech для платных
 * тестов) добавим, когда появится монетизация. Без новых зависимостей —
 * @supabase/supabase-js уже в проекте.
 */
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "audio";

/**
 * Кладёт байты аудио по `path` в bucket и возвращает публичный URL. upsert:
 * повторная загрузка того же пути перезаписывает (идемпотентно по тесту).
 */
export async function uploadAudio(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: contentType || "audio/mpeg",
      upsert: true,
    });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
