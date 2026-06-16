import { CatalogView } from "../_CatalogView";
import { LISTENING_CATEGORIES } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ListeningCatalog({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q_type?: string; limit?: string; throttled?: string }>;
}) {
  const sp = await searchParams;
  return (
    <CatalogView
      section="listening"
      categories={LISTENING_CATEGORIES}
      title="Listening"
      sub="Pick your weak spot. Filter by part and by question type."
      filterBase="/app/listening"
      sp={sp}
    />
  );
}
