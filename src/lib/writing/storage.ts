/**
 * Supabase Storage для визуалов Writing Task 1 (графики/диаграммы). SERVER-ONLY:
 * service-role клиент (owner, в обход RLS) — как uploadAudio. Bucket `writing-task1`
 * PUBLIC: картинка это НЕ answer_key (она и есть условие задания, её показываем
 * студенту), поэтому прямой public read безопасен и закрывать его нечем. Храним в
 * writing_task.image_path сам Storage-КЛЮЧ (не URL) — портативно между доменами
 * Storage; публичный URL строим из ключа. Без новых зависимостей.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/env";

export const TASK1_BUCKET = "writing-task1";

/** Допустимые MIME визуала Task 1 — растровые, читаемые vision-моделью (НЕ SVG). */
export const TASK1_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Кладёт байты картинки по `key` в bucket и возвращает тот же key (он пишется в
 * writing_task.image_path). upsert: повторная загрузка того же ключа перезаписывает.
 */
export async function uploadTask1Image(
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from(TASK1_BUCKET)
    .upload(key, bytes, { contentType: contentType || "image/png", upsert: true });
  if (error) throw error;
  return key;
}

/**
 * Публичный URL картинки по её Storage-ключу. Чистая строка (без I/O) по стабильной
 * конвенции Supabase Storage — bucket публичный, так что URL грузится в браузере
 * напрямую. NULL-ключ → null (legacy/Task 2 темы без картинки).
 */
export function task1ImageUrl(key: string | null): string | null {
  if (!key) return null;
  return `${env.SUPABASE_URL}/storage/v1/object/public/${TASK1_BUCKET}/${key}`;
}

/**
 * Скачивает картинку owner-path (service-role) и отдаёт base64 + MIME — готовый
 * inline_data part для Gemini vision. SERVER-ONLY, вызывается из роута оценки перед
 * evaluate(); сам оценщик (gemini.ts) остаётся чистым (байты приходят в EvaluateInput).
 */
export async function downloadTask1Image(
  key: string,
): Promise<{ data: string; mimeType: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(TASK1_BUCKET).download(key);
  if (error || !data) throw error ?? new Error(`Task 1 image not found: ${key}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return { data: buf.toString("base64"), mimeType: data.type || "image/png" };
}
