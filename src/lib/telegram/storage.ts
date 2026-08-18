/**
 * Загрузка аудио Listening в Supabase Storage. SERVER-ONLY: использует
 * service-role ключ (owner, в обход RLS) — как и весь импорт. Bucket `audio`
 * PUBLIC, поэтому отдаём прямой public URL; signed-доступ (anti-leech для платных
 * тестов) добавим, когда появится монетизация. Без новых зависимостей —
 * @supabase/supabase-js уже в проекте.
 *
 * Кэш на год + версия в имени файла (см. audioObjectKey в
 * src/lib/import/audio-key.ts): дефолтная отдача публичного объекта — no-cache
 * (curl-проба на бакете), т.е. каждый заход слушателя заново тянул mp3 из Storage
 * и жёг egress Free-плана. С `cacheControl` CDN кэширует объект на год; т.к. имя
 * объекта завязано на content-hash байт, новый аплоад того же теста получает
 * новое имя и не конфликтует со старой закэшированной версией.
 */
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "audio";

/**
 * Кладёт байты аудио по `path` в bucket и возвращает публичный URL. upsert:
 * повторная загрузка того же пути перезаписывает (идемпотентно по тесту — тот
 * же path получается только из тех же байт, см. audioObjectKey).
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
      cacheControl: "31536000",
    });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
