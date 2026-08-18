import { createHash } from "node:crypto";

/**
 * Версионный ключ объекта Listening-аудио в bucket `audio`. Bucket публичный и
 * теперь заливается с годовым immutable-кэшем (см. uploadAudio в
 * src/lib/telegram/storage.ts) — CDN должен различать старые и новые байты по
 * САМОМУ ИМЕНИ объекта: query-параметр (`?v=1`) НЕ входит в cache-key CDN
 * (проверено curl-пробой на бакете), поэтому единственный способ инвалидировать
 * закэшированный ответ при переливе аудио — сменить ключ. Хэш байт даёт это
 * бесплатно: те же байты → тот же ключ (upsert повторной заливки остаётся
 * идемпотентным), другие байты → другой ключ (новый cache-entry).
 *
 * Чистый модуль: без server-only / env / БД (по образцу audio-cap.ts) —
 * импортируется и webhook-роутом, и import-runner, и покрывается юнит-тестами.
 */

/** Длина хэш-суффикса в hex-символах (8 hex = 32 бита — достаточно против случайной коллизии одного теста). */
const HASH_HEX_LENGTH = 8;

/**
 * Ключ объекта в bucket `audio`: `"<contentItemId>-<первые 8 hex sha256(bytes)>.mp3"`.
 */
export function audioObjectKey(contentItemId: string, bytes: ArrayBuffer): string {
  const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex").slice(0, HASH_HEX_LENGTH);
  return `${contentItemId}-${hash}.mp3`;
}
