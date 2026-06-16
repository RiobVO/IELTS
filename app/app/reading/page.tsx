import { CatalogView } from "../_CatalogView";
import { READING_CATEGORIES } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ReadingCatalog({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q_type?: string; limit?: string; throttled?: string }>;
}) {
  const sp = await searchParams;
  return (
    <CatalogView
      section="reading"
      categories={READING_CATEGORIES}
      title="Reading"
      sub="Pick your weak spot. Filter by part and by question type."
      filterBase="/app/reading"
      sp={sp}
    />
  );
}
