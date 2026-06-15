import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { categoryLabel } from "@/lib/labels";
import { setStatus, uploadTest } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    uploaded?: string;
    q?: string;
    w?: string;
    error?: string;
  }>;
}) {
  const profile = await requireAdmin();
  const sp = await searchParams;

  // Owner db: admin sees ALL content (incl. draft), unlike the RLS anon path.
  const items = await db
    .select({
      id: contentItem.id,
      title: contentItem.title,
      section: contentItem.section,
      category: contentItem.category,
      status: contentItem.status,
      questions: sql<number>`(SELECT count(*)::int FROM question q WHERE q.content_item_id = ${contentItem.id})`,
    })
    .from(contentItem)
    .orderBy(desc(contentItem.createdAt));

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>Admin</h1>
        <p style={S.sub}>
          {profile.email} · role=admin · {items.length} тест(ов)
        </p>

        {sp.error && <p style={S.err}>{sp.error}</p>}
        {sp.uploaded && (
          <p style={S.ok}>
            Загружено: «{sp.uploaded}» — {sp.q} вопрос(ов)
            {Number(sp.w) > 0 ? `, ${sp.w} предупреждение(й)` : ""}. Статус: draft.
          </p>
        )}

        <section style={S.card}>
          <div style={S.cardTitle}>Загрузить тест (HTML)</div>
          <p style={S.hint}>
            Готовый HTML по шаблону (§4.2.1). Парсер извлечёт passage, вопросы и
            ключ; тест сохранится как draft до публикации.
          </p>
          <form action={uploadTest} style={S.uploadForm}>
            <input
              type="file"
              name="file"
              accept=".html,.htm,text/html"
              required
              style={S.file}
            />
            <button type="submit" style={S.primary}>
              Загрузить
            </button>
          </form>
        </section>

        <div style={S.listHead}>Контент</div>
        {items.length === 0 ? (
          <p style={S.hint}>Пока ничего не загружено.</p>
        ) : (
          <ul style={S.list}>
            {items.map((it) => (
              <li key={it.id} style={S.row}>
                <div style={{ minWidth: 0 }}>
                  <div style={S.rowTitle}>{it.title}</div>
                  <div style={S.meta}>
                    <span style={S.tag}>{categoryLabel(it.category)}</span>
                    <span>{it.section}</span>
                    <span>· {it.questions} вопр.</span>
                    <span style={it.status === "published" ? S.pub : S.draft}>
                      {it.status}
                    </span>
                  </div>
                </div>
                <form action={setStatus}>
                  <input type="hidden" name="id" value={it.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={it.status === "published" ? "draft" : "published"}
                  />
                  <button type="submit" style={S.ghost}>
                    {it.status === "published" ? "Снять" : "Опубликовать"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2.5rem 1.5rem 4rem", fontFamily: FONT },
  wrap: { maxWidth: 760, margin: "0 auto" },
  h1: { fontSize: "1.6rem", margin: 0 },
  sub: { color: "#777", marginTop: ".5rem", fontSize: ".9rem" },
  err: {
    background: "#fdecec",
    color: "#a11",
    padding: ".6rem .75rem",
    borderRadius: 8,
    fontSize: ".9rem",
  },
  ok: {
    background: "#eafaef",
    color: "#137a3a",
    padding: ".6rem .75rem",
    borderRadius: 8,
    fontSize: ".9rem",
  },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1.25rem",
    marginTop: "1.25rem",
  },
  cardTitle: { fontWeight: 700, fontSize: "1rem" },
  hint: { color: "#888", fontSize: ".85rem", margin: ".4rem 0 0" },
  uploadForm: {
    display: "flex",
    gap: ".75rem",
    alignItems: "center",
    marginTop: "1rem",
    flexWrap: "wrap",
  },
  file: { fontSize: ".9rem", flex: 1, minWidth: 0 },
  primary: {
    padding: ".6rem 1.1rem",
    border: "none",
    borderRadius: 8,
    background: "#6C5CE7",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  listHead: { fontWeight: 700, margin: "2rem 0 .75rem" },
  list: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: ".5rem" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: ".75rem",
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".75rem 1rem",
  },
  rowTitle: {
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    display: "flex",
    gap: ".5rem",
    alignItems: "center",
    color: "#999",
    fontSize: ".8rem",
    marginTop: ".25rem",
    flexWrap: "wrap",
  },
  tag: {
    background: "#efeafe",
    color: "#5a44d6",
    fontWeight: 700,
    padding: "1px 7px",
    borderRadius: 5,
  },
  pub: { color: "#137a3a", fontWeight: 700 },
  draft: { color: "#b8860b", fontWeight: 700 },
  ghost: {
    padding: ".5rem .9rem",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
