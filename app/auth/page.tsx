import type { Metadata } from "next";
import { cookies } from "next/headers";
import { turnstileConfig } from "@/env";
import { REF_COOKIE_NAME, sanitizeRefCode } from "@/lib/referral/link";
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
  // Реф-код: сначала явный `?ref=` (прямая ссылка на /auth), иначе — cookie,
  // которую middleware поставил, когда гость приземлился с `?ref=` на лендинг или
  // share-карточку. Без fallback код терялся на первом же переходе к форме.
  // Re-sanitize на чтении: cookie httpOnly, но пользователь-модифицируема.
  const cookieStore = await cookies();
  const refCode =
    sanitizeRefCode(sp.ref) ?? sanitizeRefCode(cookieStore.get(REF_COOKIE_NAME)?.value) ?? undefined;

  return (
    <AuthScreen
      error={sp.error}
      message={sp.message}
      refCode={refCode}
      next={sp.next ?? "/app"}
      initialMode={sp.mode === "login" ? "login" : "signup"}
      initialEmail={sp.email}
      turnstileSiteKey={turnstileConfig()?.siteKey}
    />
  );
}
