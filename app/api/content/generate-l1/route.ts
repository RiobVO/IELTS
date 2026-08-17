import { NextResponse } from "next/server";
import { cronSecret, l1GenConfig } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { generateL1ForPassage } from "@/lib/content/l1/generate";
import { claimL1, loadTestForL1, markL1Status, persistL1 } from "@/lib/content/l1/store";

export const dynamic = "force-dynamic";

// Internal, cron-secret-gated route that generates RU explanations for one test.
// Mirrors app/api/writing/evaluate/route.ts: claim → load → generate (per passage,
// parallel) → persist → status flip. A passage-level failure doesn't sink the whole
// test — Promise.allSettled lets the other passages persist their explanations.
export async function POST(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!l1GenConfig()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const { contentItemId } = (await request.json().catch(() => ({}))) as { contentItemId?: string };
  if (!contentItemId) return NextResponse.json({ ok: false }, { status: 400 });

  // Idempotent: only the pending/failed/done→generating claim winner runs. A re-fire
  // (lost-trigger re-kick, or a second trigger racing the same import) loses the
  // claim → 200 no-op, never a duplicate/overlapping generation.
  if (!(await claimL1(contentItemId))) {
    return NextResponse.json({ ok: true, claimed: false }, { status: 200 });
  }

  // После выигранного claim любой сбой обязан перевести статус в failed —
  // иначе тест навсегда залипает в generating и regenerate его не подберёт.
  try {
    const passages = await loadTestForL1(contentItemId);
    // Вопросы без ключа (пустой accept) пропускаем — объяснять нечего.
    const gradeable = passages
      .map((p) => ({ ...p, questions: p.questions.filter((q) => q.accept.some((a) => a.trim() !== "")) }))
      .filter((p) => p.questions.length > 0);

    const results = await Promise.allSettled(
      gradeable.map((p) => generateL1ForPassage({ passageBodyHtml: p.bodyHtml, questions: p.questions })),
    );

    let total = 0;
    const seen = new Set<string>();
    const toPersist: { questionId: string; explanationRu: string }[] = [];
    for (let i = 0; i < gradeable.length; i++) {
      const p = gradeable[i];
      total += p.questions.length;
      const res = results[i];
      if (res.status !== "fulfilled") {
        console.error("l1 generation failed for passage", p.passageId, res.reason);
        continue;
      }
      const questionIdByNumber = new Map(p.questions.map((q) => [q.number, q.questionId]));
      for (const item of res.value) {
        const questionId = questionIdByNumber.get(item.number);
        if (!questionId || seen.has(questionId)) continue; // номер вне набора / дубль от модели — игнор
        seen.add(questionId);
        toPersist.push({ questionId, explanationRu: item.explanation });
      }
    }

    const persisted = await persistL1(toPersist);
    // done = ПОЛНОЕ покрытие. Частичный результат остаётся failed, чтобы админ
    // видел незакрытый тест и дожал Regenerate; записанные объяснения при этом
    // сохранены и будут перезаписаны следующим полным прогоном.
    await markL1Status(contentItemId, persisted === total && total > 0 ? "done" : "failed");
    return NextResponse.json({ ok: true, claimed: true, persisted, total }, { status: 200 });
  } catch (e) {
    console.error("l1 generation failed", contentItemId, e);
    await markL1Status(contentItemId, "failed").catch(() => {});
    return NextResponse.json({ ok: false, error: "generation_failed" }, { status: 500 });
  }
}
