import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Listening-каталог свёрнут в единый хаб практики (/app/practice). Корневой роут
 * остаётся как server-redirect: переживает старые ссылки/закладки и переносит
 * предвыбор (тип вопроса / категория) в хаб через query.
 */
export default async function ListeningCatalog({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q_type?: string }>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams({ skill: "listening" });
  if (sp.q_type) p.set("q_type", sp.q_type);
  if (sp.category) p.set("category", sp.category);
  redirect(`/app/practice?${p.toString()}`);
}
