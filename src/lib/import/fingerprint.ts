import { createHash } from "node:crypto";

/**
 * Отпечаток теста по СОДЕРЖИМОМУ ключа ответов (дубль-гвард, QA 2026-07-02):
 * идемпотентность по sourceFilePath не ловит тот же тест под другим именем файла —
 * а 40 ответов именем не подделаешь. Порядок вопросов/вариантов и регистр не
 * влияют; вход — {номер, accept} как из ParsedTest, так и из answer_key-строк.
 */
export function testFingerprint(entries: Array<{ number: number; accept: unknown }>): string {
  const canon = entries
    .map((e) => {
      const list = (Array.isArray(e.accept) ? e.accept : [e.accept])
        .map((a) => String(a ?? "").trim().toUpperCase())
        .sort();
      return `${e.number}:${JSON.stringify(list)}`;
    })
    .sort()
    .join("|");
  return createHash("sha256").update(canon).digest("hex");
}
