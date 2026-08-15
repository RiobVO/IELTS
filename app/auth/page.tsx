import type { Metadata } from "next";
import { turnstileConfig } from "@/env";
import { AuthScreen } from "./AuthScreen";

export const metadata: Metadata = { title: "Sign in | bando" };

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
    ref?: string;
    mode?: string;
    email?: string;
  }>;
}) {
  const sp = await searchParams;

  return (
    <AuthScreen
      error={sp.error}
      message={sp.message}
      refCode={sp.ref}
      next={sp.next ?? "/app"}
      initialMode={sp.mode === "login" ? "login" : "signup"}
      initialEmail={sp.email}
      turnstileSiteKey={turnstileConfig()?.siteKey}
    />
  );
}
