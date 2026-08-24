// Инвариант «mock байт-в-байт» + practice-инъекция аудио-моста. «before» — точная реплика
// прежнего инлайн-пайплайна route.ts (те же функции в том же порядке); «after» —
// renderRunnerDocument. Равенство before===after доказывает, что вынос пайплайна и
// добавление practice-моста не тронули mock-выдачу ни на байт.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderRunnerDocument } from "./render-runner";
import { injectPracticeAudioBridge, PRACTICE_AUDIO_BRIDGE, retargetBridgeOrigin } from "./bridge";
import { polyfillRunnerStorage } from "./runner-storage";
import { stripAnalysisLeak } from "./sanitize-runner";
import { forceRunnerMode } from "./force-mode";
import {
  injectProgressBridge,
  skinRunnerAudioDefer,
  skinRunnerAudioLabel,
  skinRunnerBrand,
  skinRunnerGate,
} from "./skin-runner";

const GOLDEN = readFileSync(
  fileURLToPath(new URL("./fixtures/listening-client.html", import.meta.url)),
  "utf8",
);

// Пре-forceRunnerMode часть пайплайна (mode-независимая) — точная копия render-runner.ts.
function skinnedBase(html: string): string {
  const polyfilled = polyfillRunnerStorage(html);
  if (!polyfilled) throw new Error("polyfill failed — fixture без <head>?");
  const scoped = retargetBridgeOrigin(polyfilled);
  const withProgress = injectProgressBridge(scoped);
  return skinRunnerAudioLabel(
    skinRunnerAudioDefer(skinRunnerBrand(skinRunnerGate(withProgress))),
  );
}

describe("renderRunnerDocument — mock байт-в-байт", () => {
  it("mock === прежний инлайн-пайплайн (byte-identical)", () => {
    const skinned = skinnedBase(GOLDEN);
    const before = stripAnalysisLeak(forceRunnerMode(skinned, "mock", 30));
    const after = renderRunnerDocument(GOLDEN, { mode: "mock", mockMinutes: 30 });
    expect(after).toBe(before);
  });

  it("mock НЕ несёт practice-аудио-мост", () => {
    const after = renderRunnerDocument(GOLDEN, { mode: "mock", mockMinutes: 30 });
    expect(after).not.toContain("bando-practice-audio-bridge");
    expect(after).not.toContain("ielts-audio-cmd");
  });

  it("прямой GET без попытки (mode=null) — skinned без forceRunnerMode и без моста", () => {
    const skinned = skinnedBase(GOLDEN);
    const before = stripAnalysisLeak(skinned);
    const after = renderRunnerDocument(GOLDEN, { mode: null, mockMinutes: null });
    expect(after).toBe(before);
    expect(after).not.toContain("bando-practice-audio-bridge");
  });
});

describe("renderRunnerDocument — practice", () => {
  it("practice === тот же пайплайн (mode=practice) + аудио-мост, и это ЕДИНСТВЕННАЯ добавка", () => {
    const skinned = skinnedBase(GOLDEN);
    const practiceBase = stripAnalysisLeak(forceRunnerMode(skinned, "practice", null));
    const after = renderRunnerDocument(GOLDEN, { mode: "practice", mockMinutes: null });
    expect(after).not.toBeNull();
    expect(after).toBe(injectPracticeAudioBridge(practiceBase));
    // Мост — единственная добавка: снятие ровно его строки восстанавливает базовый рендер.
    expect(after!.replace(PRACTICE_AUDIO_BRIDGE, "")).toBe(practiceBase);
    expect(after).toContain("ielts-audio-cmd");
  });
});
