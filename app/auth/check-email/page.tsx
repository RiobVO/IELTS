import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckEmail } from "./CheckEmail";

export const metadata: Metadata = { title: "Check your email | bando" };

/**
 * Экран «Check your email». Показывается в двух случаях (оба — только когда тумблер
 * Supabase «Confirm email» ВКЛ):
 *   - сразу после signUp, когда сессии ещё нет и письмо с подтверждением ушло;
 *   - при попытке входа паролем с неподтверждённой почтой (signIn ловит
 *     «Email not confirmed» и уводит сюда с кнопкой resend вместо сырой ошибки).
 * Адрес и флаг «только что отправлено» приходят query-параметрами от server actions.
 * Прямой заход/refresh без email теряет контекст и бессмыслен → уводим на /auth.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.email) redirect("/auth");
  return <CheckEmail email={sp.email} justSent={sp.sent === "1"} />;
}
