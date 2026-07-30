// Юнит-тесты constant-time HMAC-проверки вебхука (D1 seam). Контракт: верная
// подпись → true; неверная/чужой секрет/изменённое тело/пустая/не-hex/неверная
// длина → false. Чистая функция (node:crypto), без env/db.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { hmacHexValid } from "./webhook-signature";

const secret = "test_secret";
const body = '{"providerTransactionId":"abc"}';
const good = createHmac("sha256", secret).update(body).digest("hex");

describe("hmacHexValid", () => {
  it("true для корректной подписи", () => {
    expect(hmacHexValid(secret, good, body)).toBe(true);
  });

  it("false для чужого секрета (тот же размер, не сходится)", () => {
    const wrong = createHmac("sha256", "other_secret").update(body).digest("hex");
    expect(hmacHexValid(secret, wrong, body)).toBe(false);
  });

  it("false при изменённом теле", () => {
    expect(hmacHexValid(secret, good, body + "x")).toBe(false);
  });

  it("false для пустой / отсутствующей подписи", () => {
    expect(hmacHexValid(secret, null, body)).toBe(false);
    expect(hmacHexValid(secret, undefined, body)).toBe(false);
    expect(hmacHexValid(secret, "", body)).toBe(false);
  });

  it("false для неверной длины / не-hex подписи", () => {
    expect(hmacHexValid(secret, "deadbeef", body)).toBe(false); // короче
    expect(hmacHexValid(secret, "zz".repeat(32), body)).toBe(false); // не-hex
  });
});
