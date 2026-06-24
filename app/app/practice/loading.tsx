import { AppShellSkeleton, PracticeSkeleton } from "@/components/app/Skeletons";

export default function Loading() {
  return (
    <AppShellSkeleton active="practice">
      <PracticeSkeleton />
    </AppShellSkeleton>
  );
}
