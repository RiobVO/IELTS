import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { vocabDeck } from "@/db/schema";
import { getDeckBrowse, getVocabCatalog } from "@/lib/vocab/queries";
import { isUuid } from "@/lib/uuid";
import { Button } from "@/components/core/Button";
import { AppShell } from "../../../_AppShell";

export const dynamic = "force-dynamic";

// Динамический title вкладки — имя дека вместо статичного дефолта, тот же read-only
// принцип, что в [deckId]/page.tsx (без getVocabCatalog/getDeckBrowse — та бизнес-
// логика гейтит published/tier для тела страницы, метаданным она не нужна).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ deckId: string }>;
}): Promise<Metadata> {
  const { deckId } = await params;
  if (!isUuid(deckId)) return { title: "Browse deck | bando" };
  // Published-гейт — тот же, что у getDeckBrowse (vocab/queries.ts): draft-дек не
  // должен светить title в <title> вкладки раньше собственного notFound страницы.
  const [row] = await db
    .select({ title: vocabDeck.title })
    .from(vocabDeck)
    .where(and(eq(vocabDeck.id, deckId), eq(vocabDeck.status, "published")))
    .limit(1);
  return { title: row ? `${row.title} — Browse | bando` : "Browse deck | bando" };
}

/** Цвет статус-точки: нет прогресса → нейтральный, начата → brand, освоена → success. */
const STATUS_COLOR: Record<string, string> = {
  new: "var(--slate-300)",
  learning: "var(--brand)",
  mastered: "var(--success)",
};

/**
 * Read-only список слов дека (`/app/vocabulary/[deckId]/browse`, V13). Гейт — тот же,
 * что в сессии повторов ([deckId]/page.tsx): uuid-мусор → notFound; дек не найден в
 * published-каталоге → notFound; locked по тиру → redirect на /app/upgrade.
 * getDeckBrowse держит свой owner-path гейт (published + тир) отдельно, поэтому
 * null оттуда после прохождения каталога — defensive notFound, а не ожидаемый путь.
 * Полностью серверный рендер: прогресс не пишет и не читает очередь повторов.
 */
export default async function VocabDeckBrowsePage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const user = await requireUser();
  const { deckId } = await params;
  if (!isUuid(deckId)) notFound();

  const [catalog, browse] = await Promise.all([
    getVocabCatalog(user.id),
    getDeckBrowse(user.id, deckId),
  ]);
  const deck = catalog.find((d) => d.id === deckId);
  if (!deck) notFound();
  if (deck.locked) redirect("/app/upgrade");
  if (!browse) notFound();

  return (
    <AppShell active="vocabulary">
      <div style={S.wrap}>
        <style>{CSS}</style>

        <div className="vcb-head" style={S.head}>
          <div>
            <h1 style={S.title}>{browse.deckTitle} — all words</h1>
            <p style={S.sub}>{browse.totalCards} words · read-only, doesn&apos;t affect your reviews</p>
          </div>
          <Button href={`/app/vocabulary/${deckId}`} variant="secondary" size="sm">
            Start review instead
          </Button>
        </div>

        {browse.cards.length === 0 ? (
          <p style={S.empty}>No cards yet.</p>
        ) : (
          <div className="vcb-tablewrap">
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Word</th>
                  <th style={S.th}>Definition</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {browse.cards.map((c) => (
                  <tr key={c.id}>
                    <td style={S.wordCell}>
                      <span style={S.word}>{c.word}</span>
                      {c.partOfSpeech && <span style={S.pos}>{c.partOfSpeech}</span>}
                    </td>
                    <td style={S.defCell}>{c.definition}</td>
                    <td style={S.statusCell}>
                      <span style={S.statusDot}>
                        <i style={{ ...S.dotI, background: STATUS_COLOR[c.status] }} />
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* Мобильный инвариант: таблица шире экрана скроллится в своём контейнере
   (overflow-x), а не ломает страницу; min-width на таблице — константа, не
   брейкпоинт-свойство, поэтому живёт инлайном. */
const CSS = `
.vcb-head{flex-wrap:wrap}
.vcb-tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
@media (min-width:768px){
  .vcb-head{flex-wrap:nowrap}
}
`;

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 900, margin: "0 auto", padding: "24px 16px 56px", display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-ui)", color: "var(--text-primary)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.015em", color: "var(--text-primary)" },
  sub: { margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)" },

  table: { width: "100%", minWidth: 520, borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "12px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" },
  wordCell: { padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap" },
  word: { marginRight: 6 },
  pos: { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--text-disabled)" },
  defCell: { padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", fontSize: 13.5, color: "var(--text-secondary)" },
  statusCell: { padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" },
  statusDot: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" },
  dotI: { width: 8, height: 8, borderRadius: "50%", flex: "none", display: "block" },

  empty: { padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 },
};
