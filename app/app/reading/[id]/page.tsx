import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel, qtypeLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
  group_key: string | null;
}

export default async function ReadingTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("content_item")
    .select("id,title,category,duration_seconds")
    .eq("id", id)
    .single();
  if (!test) notFound();

  const { data: passages } = await supabase
    .from("passage")
    .select("title,body_html,\"order\"")
    .eq("content_item_id", id)
    .order("order");

  // NOTE: answer_key is intentionally NOT fetched — it's RLS-locked and never
  // reaches the client before submit (BRIEF §4.2).
  const { data: questionsData } = await supabase
    .from("question")
    .select("id,number,qtype,prompt_html,options,group_key")
    .eq("content_item_id", id)
    .order("number");
  const questions = (questionsData ?? []) as Question[];

  return (
    <main style={S.page}>
      <div style={S.header}>
        <Link href="/app/reading" style={S.back}>
          ← Каталог
        </Link>
        <div style={S.meta}>
          <span style={S.badge}>{categoryLabel(test.category)}</span>
          {test.duration_seconds ? (
            <span style={S.dur}>{Math.round(test.duration_seconds / 60)} мин</span>
          ) : null}
        </div>
      </div>

      <div style={S.notice}>
        Предпросмотр (только чтение). Интерактивное прохождение с таймером и
        проверкой — следующий шаг.
      </div>

      <div style={S.cols}>
        <section style={S.passageCol}>
          {(passages ?? []).map((p, i) => (
            <article
              key={i}
              style={S.passage}
              // Trusted imported content (our own structural HTML); full
              // sanitization pass is a later hardening step.
              dangerouslySetInnerHTML={{ __html: p.body_html as string }}
            />
          ))}
        </section>

        <section style={S.qCol}>
          <h2 style={S.qHeading}>Questions 1–{questions.length}</h2>
          {questions.map((q) => (
            <div key={q.id} style={S.q}>
              <div style={S.qHead}>
                <span style={S.qNum}>{q.number}</span>
                <span style={S.qType}>{qtypeLabel(q.qtype)}</span>
              </div>
              <div style={S.qPrompt}>{q.prompt_html}</div>
              {q.options && q.options.length > 0 ? (
                <div style={S.opts}>
                  {q.options.map((o) => (
                    <label key={o.value} style={S.opt}>
                      <input type="radio" disabled name={`q${q.number}`} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  style={S.input}
                  disabled
                  placeholder="ответ (one word only)"
                />
              )}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const READING_FONT = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", fontFamily: FONT, padding: "1.25rem" },
  header: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  back: { color: "#6C5CE7", fontSize: ".9rem" },
  meta: { display: "flex", gap: ".6rem", alignItems: "center" },
  badge: {
    background: "#efeafe",
    color: "#5a44d6",
    fontWeight: 700,
    fontSize: ".72rem",
    padding: "3px 9px",
    borderRadius: 6,
  },
  dur: { color: "#999", fontSize: ".82rem" },
  notice: {
    maxWidth: 1100,
    margin: ".8rem auto 0",
    background: "#fff8e6",
    border: "1px solid #f6e6b8",
    color: "#8a6d1b",
    borderRadius: 8,
    padding: ".6rem .8rem",
    fontSize: ".85rem",
  },
  cols: {
    maxWidth: 1100,
    margin: "1rem auto 0",
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "1.25rem",
  },
  passageCol: {},
  passage: {
    fontFamily: READING_FONT,
    fontSize: "1.02rem",
    lineHeight: 1.7,
    color: "#1c1c22",
  },
  qCol: {
    borderTop: "1px solid #eee",
    paddingTop: "1rem",
  },
  qHeading: { fontSize: "1.1rem", margin: "0 0 1rem" },
  q: {
    border: "1px solid #ececf1",
    borderRadius: 10,
    padding: ".8rem .9rem",
    marginBottom: ".7rem",
  },
  qHead: { display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".4rem" },
  qNum: {
    background: "#111827",
    color: "#fff",
    fontWeight: 800,
    fontSize: ".75rem",
    width: 22,
    height: 22,
    borderRadius: 5,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  qType: { color: "#999", fontSize: ".72rem" },
  qPrompt: { fontSize: ".95rem", lineHeight: 1.5, marginBottom: ".5rem" },
  opts: { display: "flex", flexDirection: "column", gap: ".3rem" },
  opt: { display: "flex", alignItems: "center", gap: ".4rem", fontSize: ".9rem", color: "#555" },
  input: {
    padding: ".5rem .7rem",
    border: "1px solid #ddd",
    borderRadius: 7,
    fontSize: ".9rem",
    width: "100%",
    maxWidth: 260,
  },
};
