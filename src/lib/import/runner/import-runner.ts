import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage } from "@/db/schema";
import { uploadAudio } from "@/lib/telegram/storage";
import { parseRunner } from "./parse-runner";
import { sanitizeRunner, assertNoKeyLeak } from "./sanitize-runner";
import { persistTest } from "../persist";

export interface ImportRunnerResult {
  id: string;
  title: string;
  questions: number;
  warnings: number;
}

/** Полный импорт обёртки: parse → persist → (audio) → sanitize → runner_html. */
export async function importRunner(
  html: string,
  opts: { sourceFilePath?: string; createdBy?: string },
): Promise<ImportRunnerResult> {
  const { parsed, externalAudioSrc } = parseRunner(html);

  // 1. Persist ключи/метаданные (получаем id)
  const contentItemId = await persistTest(parsed, opts);

  // 2. Аудио (listening): скачать внешний mp3 → наш Storage → подменить src
  let audioUrl: string | undefined;
  if (parsed.section === "listening" && externalAudioSrc) {
    const res = await fetch(externalAudioSrc);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${externalAudioSrc}`);
    const bytes = await res.arrayBuffer();
    audioUrl = await uploadAudio(`${contentItemId}.mp3`, bytes, "audio/mpeg");
    await db
      .update(passage)
      .set({ audioPath: audioUrl })
      .where(and(eq(passage.contentItemId, contentItemId), eq(passage.order, 1)));
  }

  // 3. Очистить файл и проверить анти-утечку
  const runnerHtml = sanitizeRunner(html, {
    contentItemId,
    section: parsed.section,
    audioUrl,
  });
  assertNoKeyLeak(runnerHtml, parsed);

  // 4. Сохранить runner_html
  await db.update(contentItem).set({ runnerHtml }).where(eq(contentItem.id, contentItemId));

  return {
    id: contentItemId,
    title: parsed.title,
    questions: parsed.questions.length,
    warnings: parsed.warnings.length,
  };
}
