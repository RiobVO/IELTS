import { CatalogView } from "../_CatalogView";
import { LISTENING_CATEGORIES } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ListeningCatalog({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q_type?: string }>;
}) {
  const sp = await searchParams;
  return (
    <CatalogView
      section="listening"
      categories={LISTENING_CATEGORIES}
      title="Listening"
      sub="Выбери тест. Фильтруй по части и типам вопросов."
      filterBase="/app/listening"
      sp={sp}
    />
  );
}
