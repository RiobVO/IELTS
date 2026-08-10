/**
 * CLI: разобрать JSON-файл словарной колоды и записать её в БД (идемпотентный
 * upsert по source_file_path; новый дек — status=draft).
 *   tsx scripts/import-vocab.ts <path-to-deck.json>
 * Браузерная админка делает то же самое из формы; это headless-эквивалент.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, "..", ".env.local") });

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/import-vocab.ts <path-to-deck.json>");
  process.exit(1);
}

// Динамический импорт — чтобы dotenv успел загрузиться до валидации env в @/db.
const { importVocabDeck } = await import("../src/lib/import/vocab/persist-vocab.ts");

const r = await importVocabDeck(readFileSync(resolve(path), "utf8"), path);
console.log(
  `Imported deck ${r.deckId} — ${r.inserted} inserted, ${r.updated} updated, ` +
    `${r.totalCards} total card(s).`,
);
process.exit(0);
