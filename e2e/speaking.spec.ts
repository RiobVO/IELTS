import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { loginAs } from "./auth";
import {
  SEED_SPEAKING_TASK_ID,
  ULTRA_EMAIL,
  ULTRA_PASSWORD,
  deleteSpeakingSubmissionsByEmail,
  injectCompletedSpeakingFeedback,
} from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Speaking Lab golden path против hosted тест-стенда (волна 3b, TESTING_PLAN §9):
// permission (fake media) → запись → РЕАЛЬНЫЙ upload в Storage тест-стенда → pending →
// инъекция готового фидбека В БД → result → реальный delete-флоу (удаление записи).
//
// НИ ОДНОГО реального Gemini-вызова и НИ ОДНОГО запроса на прод: как и writing.spec,
// раннер держит фичу ВКЛючённой (NEXT_PUBLIC_SITE_URL = http://localhost:3000, baseURL
// этого же прогона) — triggerEvaluate-fetch на /api/speaking/evaluate обрывается по пути
// в undici-преloade (scripts/e2e-undici-resilience.mjs) синхронно, до сокета, submission
// остаётся pending; фидбек пишем напрямую в speaking_feedback.
//
// ULTRA_EMAIL = ultra (seed.ts) → Speaking=Ultra: без preview-лимита (только дневной кап
// 10), поэтому повторные прогоны детерминированно зелёные. Consent засеян в global-setup
// (recording_consent_at) → attempt минует ConsentModal, показывает prep-экран.
// speaking_feedback_debug НЕ трогаем (hard-lock).

const RECORD_MS = 12_000; // ≥ MIN_SECONDS(10s) floor в _Attempt.tsx, с запасом на округление

/**
 * Генерирует WAV с непрерывным громким тоном и отдаёт абсолютный путь. Дефолтный
 * синтетик Chromium (`--use-fake-device-for-media-stream`) выдаёт ПРЕРЫВИСТЫЙ бип —
 * AnalyserNode в useSpeakingRecorder семплит peak раз в 250мс и мог промахнуться мимо
 * бипа, оставив peak < MIN_PEAK(0.04) → Submit залочен silence-гейтом (флак: проходило
 * ~через раз). Непрерывный тон 440 Гц @ 0.6 амплитуды через
 * `--use-file-for-fake-audio-capture` даёт peak ≈ 0.6 на всей записи — детерминированно.
 */
function makeToneWavPath(): string {
  const sampleRate = 16_000;
  const seconds = 1; // файл луупится драйвером на всю длину записи
  const freq = 440;
  const amp = 0.6;
  const n = sampleRate * seconds;
  const dataLen = n * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits/sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
    buf.writeInt16LE(Math.round(s * 32_767), 44 + i * 2);
  }
  const p = join(mkdtempSync(join(tmpdir(), "e2e-speak-")), "tone.wav");
  writeFileSync(p, buf);
  return p;
}

// Fake-медиа Chromium: авто-грант разрешения + непрерывный тон-файл как микрофон (peak
// стабильно > MIN_PEAK). WAV раньше создавался на module-scope и никогда не удалялся
// (внешнее ревью) — теперь это worker-scoped фикстура: файл создаётся один раз перед
// первым тестом воркера (launchOptions worker-scoped, запускается ДО beforeAll — раньше
// каталог не удалить) и его временный каталог удаляется, когда воркер закрывает браузер.
// Отдельный spec-файл → reading/vocab/writing не задеты.
const test = base.extend<object, { toneWavPath: string }>({
  toneWavPath: [
    async ({}, use) => {
      const p = makeToneWavPath();
      await use(p);
      rmSync(dirname(p), { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  launchOptions: [
    async ({ launchOptions, toneWavPath }, use) => {
      await use({
        ...launchOptions,
        args: [
          ...(launchOptions.args ?? []),
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-audio-capture=${toneWavPath}`,
        ],
      });
    },
    { scope: "worker" },
  ],
});

test.describe("speaking record → upload → polling → injected feedback → result → delete", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test.afterAll(async () => {
    // Сносим сабмишны + аудио-объекты ultra-юзера — не оставляем сирот в бакете (1 GB Free)
    // и completed-строку на следующий прогон.
    await deleteSpeakingSubmissionsByEmail(ULTRA_EMAIL);
  });

  test("record, upload, inject feedback, see result, then delete the recording", async ({
    page,
  }) => {
    // Идемпотентный старт: снести прежние сабмишны+аудио (one-active index 0028).
    await deleteSpeakingSubmissionsByEmail(ULTRA_EMAIL);

    await loginAs(page, ULTRA_EMAIL, ULTRA_PASSWORD);
    await page.goto(`/app/speaking/attempt/${SEED_SPEAKING_TASK_ID}`);

    // Consent засеян → prep-экран. Пропускаем prep-таймер вручную (не ждём 60с).
    await page.getByRole("button", { name: "Skip to recording" }).click();

    // Запись пошла: появляется кнопка Stop (RecordingPanel). Записываем ≥10с, иначе
    // StoppedPanel уведёт в too-short ветку с залоченным Submit.
    const stop = page.getByRole("button", { name: "Stop recording" });
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(RECORD_MS);
    await stop.click();

    // Взятие захвачено → Submit активен (не too-short: длительность+peak прошли гейт).
    const submit = page.getByRole("button", { name: "Submit for feedback" });
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    await submit.click();

    // Submit прогоняет реальный signed-PUT в Storage тест-стенда + markSpeakingUploaded →
    // triggerEvaluate (loopback, падает) → step="analyzing". Экран анализа = pending-UI.
    await expect(page.getByText("Analyzing your answer")).toBeVisible({ timeout: 20_000 });

    // Инъекция «завершённого эвала»: находит pending-сабмишн ultra-юзера, пишет
    // speaking_feedback (transcript НЕпустой), флипает в completed. Поллинг (2.5с) → result.
    const submissionId = await injectCompletedSpeakingFeedback(ULTRA_EMAIL);

    await page.waitForURL(`**/app/speaking/result/${submissionId}`, { timeout: 25_000 });

    // Result рендерит инъектированные данные: BandHero-оверлайн + маркер транскрипта.
    await expect(page.getByText("Estimated band")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/E2E_SPEAKING_TRANSCRIPT/)).toBeVisible();

    // Реальный delete-флоу: «Delete recording» → подтверждение «Delete» → deleteSpeakingRecording
    // (service-role remove аудио из Storage + wipe транскрипта) → блок показывает «removed».
    await page.getByRole("button", { name: "Delete recording" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Transcript removed" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
