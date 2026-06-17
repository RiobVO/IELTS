import { turnstileConfig } from "@/env";
import { AuthScreen } from "./AuthScreen";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
    ref?: string;
  }>;
}) {
  const sp = await searchParams;

  return (
    <AuthScreen
      error={sp.error}
      message={sp.message}
      refCode={sp.ref}
      next={sp.next ?? "/app"}
      turnstileSiteKey={turnstileConfig()?.siteKey}
    />
  );
}
