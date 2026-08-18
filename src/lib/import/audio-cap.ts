/**
 * Единый лимит размера аудио при импорте Listening (Telegram-mp3 и внешнее аудио
 * из runner-HTML). Storage на Supabase Free = 1 GB, egress 5 GB/мес — перед разовой
 * волной ~600 юзеров egress бьёт размер файла напрямую, поэтому целевой профиль
 * ужесточён: mp3, mono, 48 kbps, 32 kHz (ниже не опускаемся — разборчивость речи
 * прямо влияет на баллы). Full Listening — ОДИН mp3 на тест (~30+ мин): на целевом
 * профиле это ≈10.8 MB, поэтому лимит 12 MB — пропускает целевой профиль с запасом,
 * а более тяжёлые исходники (64 kbps+/стерео/несжатые) отсекает ДО заливки в bucket.
 *
 * Чистый модуль: без server-only / env / БД — импортируется и webhook-роутом, и
 * import-runner, и покрывается юнит-тестами напрямую (как safe-audio-fetch.ts).
 */

/** Лимит в мегабайтах — используется и в тексте сообщений (без дробной части). */
export const MAX_IMPORT_AUDIO_MB = 12;

/** Лимит в байтах — то, с чем сравниваем фактический/заявленный размер файла. */
export const MAX_IMPORT_AUDIO_BYTES = MAX_IMPORT_AUDIO_MB * 1024 * 1024;

/** Байты → мегабайты для человекочитаемых сообщений (1 знак после запятой). */
function bytesToMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * true, если размер укладывается в лимит. Граница включительна (ровно 12 MB — ок):
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
    `пережми mp3: mono, 48 kbps, 32 kHz — и пришли снова.`
  );
}
