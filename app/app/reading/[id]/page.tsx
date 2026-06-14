import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/labels";
import ExamRunner from "./ExamRunner";

export const dynamic = "force-dynamic";

interface Question {
  id: string;
  number: number;
  qtype: string;
  prompt_html: string;
  options: { value: string; label: string }[] | null;
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
    .select('title,body_html,"order"')
    .eq("content_item_id", id)
    .order("order");

  // answer_key is intentionally NOT fetched (RLS-locked; no leak before submit).
  const { data: questionsData } = await supabase
    .from("question")
    .select("id,number,qtype,prompt_html,options,group_key")
    .eq("content_item_id", id)
    .order("number");

  return (
    <main style={{ minHeight: "100dvh", padding: "1.25rem", fontFamily: FONT }}>
      <div style={head}>
        <Link href="/app/reading" style={back}>
          ← Каталог
        </Link>
        <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
          <span style={badge}>{categoryLabel(test.category)}</span>
          <span style={{ fontWeight: 700 }}>{test.title}</span>
        </div>
      </div>

      <ExamRunner
        contentItemId={id}
        passages={(passages ?? []) as never}
        questions={(questionsData ?? []) as Question[]}
        durationSeconds={test.duration_seconds}
      />
    </main>
  );
}

const FONT =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const head: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const back: React.CSSProperties = { color: "#6C5CE7", fontSize: ".9rem" };
const badge: React.CSSProperties = {
  background: "#efeafe",
  color: "#5a44d6",
  fontWeight: 700,
  fontSize: ".72rem",
  padding: "3px 9px",
  borderRadius: 6,
};
