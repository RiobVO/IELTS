/**
 * THROWAWAY prod-restore after the db:down incident (delete after use). ADDITIVE +
 * IDEMPOTENT by construction: only INSERT-if-absent. NO down/migrate/DROP/DELETE/
 * UPDATE-without-WHERE — it cannot remove or overwrite anything.
 *
 *   npx tsx scripts/_restore_prod.ts            # DRY-RUN: prints what it would write
 *   npx tsx scripts/_restore_prod.ts --apply    # writes to whatever DIRECT_URL points at
 *
 * Restores: (1) profile rows backfilled from the intact auth.users (id + email, defaults
 * for the rest); (2) the 13 Writing Task 2 prompts. Task 1 (5) is restored separately by
 * the existing idempotent scripts/seed-task1-demo.ts. Reading/Listening need the original
 * HTML and are NOT covered here.
 *
 * Task 2 sources: prompts 1–6 are VERBATIM from docs/writing-lab-catalog-handoff/README.md;
 * prompts 7–13 are from the prod catalog read pre-incident (standard public IELTS prompts).
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");

type T2 = {
  topic: "society" | "environment" | "crime" | "technology" | "food" | "culture";
  taskType: "discussion" | "agree_disagree" | "adv_disadv" | "two_part" | "pos_neg";
  difficulty: 1 | 2 | 3; // Foundation | Core | Stretch
  bandLow: string;
  bandHigh: string;
  prompt: string;
};

// 1–6 verbatim from the handoff doc.
const TASK2: T2[] = [
  { topic: "society", taskType: "adv_disadv", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: 'Young people are often influenced in their behaviour by others of the same age — this is called "peer pressure". Do the advantages outweigh the disadvantages?' },
  { topic: "environment", taskType: "pos_neg", difficulty: 1, bandLow: "6.5", bandHigh: "7.5",
    prompt: "With the growing population of cities, more and more people live in homes that have little or no outdoor area. Is this a positive or negative development?" },
  { topic: "crime", taskType: "two_part", difficulty: 3, bandLow: "7.0", bandHigh: "8.0",
    prompt: "In many countries, children and teenagers are committing more crimes. Why is this happening? How should they be punished?" },
  { topic: "technology", taskType: "discussion", difficulty: 2, bandLow: "7.0", bandHigh: "8.0",
    prompt: "Some people believe that technology has made life more complex, while others think it has simplified it. Discuss both views and give your own opinion." },
  { topic: "food", taskType: "agree_disagree", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "In many countries, traditional foods are being replaced by international fast food. This is having a negative effect on both families and societies. To what extent do you agree or disagree?" },
  { topic: "culture", taskType: "agree_disagree", difficulty: 1, bandLow: "6.0", bandHigh: "7.0",
    prompt: "The best way to understand other cultures is to work for a multinational organization. To what extent do you agree or disagree?" },
  // 7–13 from the prod catalog read pre-incident.
  { topic: "society", taskType: "discussion", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "Some people think charity organizations should only help people of their own country, while others believe they should give aid to anyone in great need, wherever they live. Discuss both views and give your own opinion." },
  { topic: "society", taskType: "agree_disagree", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "Some experts believe that when a country is already rich, any additional increase in economic wealth does not make its citizens any more satisfied. To what extent do you agree or disagree?" },
  { topic: "environment", taskType: "two_part", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "In many countries, the cost of using public transport is rising rapidly. What are the causes of this problem? What solutions can be implemented to address it?" },
  { topic: "environment", taskType: "agree_disagree", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "As we face more and more problems that affect the whole planet, good relationships between different countries are becoming more important than ever. To what extent do you agree or disagree?" },
  { topic: "society", taskType: "discussion", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "Some people think the best way to be successful in life is to get a university education. Others disagree and say this is no longer true. Discuss both views and give your own opinion." },
  { topic: "environment", taskType: "two_part", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "In many countries, household waste such as food packaging is increasing day by day. What are the reasons? How can this problem be solved?" },
  { topic: "society", taskType: "discussion", difficulty: 2, bandLow: "6.5", bandHigh: "7.5",
    prompt: "Some people believe that universities should focus only on academic subjects, while others think they should also teach practical skills for future careers. Discuss both views and give your own opinion." },
];

async function main() {
  const { db } = await import("@/db");
  const { sql, eq } = await import("drizzle-orm");
  const { writingTask } = await import("@/db/schema");

  const host = (process.env.DIRECT_URL ?? "").replace(/:\/\/[^@]*@/, "://***@").replace(/(@[^:/]+).*/, "$1");
  console.log(`TARGET host: ${host}`);
  console.log(`MODE: ${APPLY ? "APPLY — will WRITE" : "DRY-RUN — no writes"}\n`);

  // ── Block 1: profile backfill from auth.users (id + email; rest = column defaults) ──
  const missingRes = await db.execute(sql`
    select count(*)::int as n from auth.users u
    where u.email is not null and not exists (select 1 from profile p where p.id = u.id)`);
  // node-postgres driver may return the rows array directly or wrapped in { rows }.
  const missingRows = ((Array.isArray(missingRes)
    ? missingRes
    : (missingRes as { rows?: { n: number }[] }).rows) ?? []) as { n: number }[];
  const missing = missingRows[0]?.n ?? 0;
  console.log(`[profile] auth.users without a profile: ${missing}`);
  if (APPLY && missing > 0) {
    // Mirror the on_auth_user_created trigger (migration 0002_auth) so restored rows are
    // identical to trigger-born ones: referral_code is NOT NULL with no DB default, and
    // provider/display_name come from the auth metadata. Still additive (ON CONFLICT DO NOTHING).
    await db.execute(sql`
      insert into profile (id, email, auth_provider, display_name, referral_code)
      select
        u.id,
        u.email,
        (case when coalesce(u.raw_app_meta_data->>'provider','email') in ('email','apple','facebook')
              then coalesce(u.raw_app_meta_data->>'provider','email') else 'email' end)::auth_provider,
        coalesce(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
        upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 10))
      from auth.users u
      where u.email is not null
      on conflict (id) do nothing`);
    console.log(`[profile] backfilled ${missing} row(s)`);
  }

  // ── Block 2: Task 2 prompts (skip if the exact prompt already exists) ──
  let seeded = 0, skipped = 0;
  for (const t of TASK2) {
    const exists = await db.select({ id: writingTask.id }).from(writingTask)
      .where(eq(writingTask.prompt, t.prompt)).limit(1);
    if (exists.length > 0) { skipped++; continue; }
    console.log(`  + [${t.topic}/${t.taskType}] ${t.prompt.slice(0, 56)}…`);
    if (APPLY) {
      await db.insert(writingTask).values({
        category: "academic", taskPart: "task2", prompt: t.prompt,
        topic: t.topic, taskType: t.taskType, difficulty: t.difficulty,
        bandLow: t.bandLow, bandHigh: t.bandHigh, tierRequired: "premium", status: "published",
      });
    }
    seeded++;
  }
  console.log(`\n[task2] ${APPLY ? "seeded" : "would seed"} ${seeded}, skipped ${skipped} (of ${TASK2.length})`);
  console.log(APPLY ? "\n[OK] applied" : "\n[DRY-RUN] nothing written — re-run with --apply to write");
  process.exit(0);
}

main().catch((e) => { console.error("[FAIL]", e); process.exit(1); });
