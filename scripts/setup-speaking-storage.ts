import { config } from "dotenv";
config({ path: ".env.local" });

// ПРОД-провижининг Storage через КАНОН (scripts/lib/storage-provisioning.ts) —
// приватный `speaking-audio` (10 MB, форматы MediaRecorder) + owner-scoped
// `storage.objects` policy, и заодно приватный `source-html` (без политики).
// Storage живёт в схеме `storage` реального Supabase (локальный docker не эмулирует) —
// идёт против ПРОДА по DIRECT_URL (.env.local), НЕ через verify-гейт и НЕ через
// loadTestTargetEnv (это прод-setup, не тест-стенд). Драйвер — postgres.js (как migrate.ts).
async function main() {
  const postgres = (await import("postgres")).default;
  const { applyStorageProvisioning } = await import("./lib/storage-provisioning.ts");
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL missing");
  // Прозрачность (это ПРОД-мутация Storage): печатаем целевой хост, чтобы оператор
  // видел, куда применяется провижининг. Guard на конкретный ref намеренно НЕ ставим —
  // это прод-скрипт (симметрично `db:migrate` up, что тоже идёт на прод без guard).
  const host = (() => { try { return new URL(url).hostname; } catch { return "(unparseable)"; } })();
  console.log(`provisioning Storage against ${host} (DIRECT_URL from .env.local)`);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await applyStorageProvisioning(sql);
    console.log("[OK] speaking-audio + source-html buckets provisioned from canon");
  } finally {
    await sql.end();
  }
  process.exit(0);
}
main().catch((e) => { console.error("[FAIL]", e); process.exit(1); });
