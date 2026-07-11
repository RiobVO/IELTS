/**
 * Единый лимит размера аудио при импорте Listening (Telegram-mp3 и внешнее аудио
 * из runner-HTML). Storage на Supabase Free = 1 GB, поэтому mp3 держим сжатыми:
 * ориентир ≤64–96 kbps mono. Full Listening — ОДИН mp3 на тест (~30+ мин): при
 * 64 kbps mono это ≈14.4 MB, поэтому лимит 15 MB — пропускает полный тест на
 * целевом битрейте, а несжатые/стерео-исходники (30–40 МБ на 128 kbps+) отсекает
 * ДО заливки в bucket.
 *
 * Чистый модуль: без server-only / env / БД — импортируется и webhook-роутом, и
 * import-runner, и покрывается юнит-тестами напрямую (как safe-audio-fetch.ts).
 */

/** Лимит в мегабайтах — используется и в тексте сообщений (без дробной части). */
export const MAX_IMPORT_AUDIO_MB = 15;

/** Лимит в байтах — то, с чем сравниваем фактический/заявленный размер файла. */
export const MAX_IMPORT_AUDIO_BYTES = MAX_IMPORT_AUDIO_MB * 1024 * 1024;

/** Байты → мегабайты для человекочитаемых сообщений (1 знак после запятой). */
function bytesToMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * true, если размер укладывается в лимит. Граница включительна (ровно 15 MB — ок):
 * отсекаем только то, что СТРОГО больше лимита.
 */
export function withinAudioCap(bytes: number): boolean {
  return bytes <= MAX_IMPORT_AUDIO_BYTES;
}

/**
 * Actionable-сообщение боту (RU) при превышении лимита: сколько весит файл, каков
 * лимит и что делать (пережать до целевого битрейта и прислать заново).
 */
export function audioTooLargeMessage(bytes: number): string {
  return (
    `Файл ${bytesToMb(bytes)} MB превышает лимит ${MAX_IMPORT_AUDIO_MB} MB — ` +
    `пережми mp3 (≤64–96 kbps mono) и пришли снова.`
  );
}
