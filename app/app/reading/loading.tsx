import { AppShellSkeleton, CatalogSkeleton } from "@/components/app/Skeletons";

export default function Loading() {
  return (
    <AppShellSkeleton active="reading">
      <CatalogSkeleton />
    </AppShellSkeleton>
  );
}
