/**
 * Детектор ошибки Supabase «Email not confirmed» (возвращается
 * signInWithPassword, когда тумблер «Confirm email» в Supabase ВКЛючён, а почта
 * пользователя ещё не подтверждена).
 *
 * Вынесен в чистую функцию: решение «увести на экран подтверждения с кнопкой
 * resend вместо показа сырой ошибки в форме» тестируется без сети/Supabase.
 * Матчим по подстроке без учёта регистра — капитализация текста провайдера может
 * меняться, но ядро «email not confirmed» стабильно. Когда тумблер ВЫКЛ, эта
 * ошибка не возникает вовсе, поэтому ветка мертва и поведение прода не меняется.
 */
export function isEmailNotConfirmed(message: string | null | undefined): boolean {
  return (
    typeof message === "string" &&
    message.toLowerCase().includes("email not confirmed")
  );
}
