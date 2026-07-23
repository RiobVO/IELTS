import { AppShellSkeleton, CatalogSkeleton } from "@/components/app/Skeletons";

export default function Loading() {
  return (
    <AppShellSkeleton active="listening">
      <CatalogSkeleton />
    </AppShellSkeleton>
  );
}
