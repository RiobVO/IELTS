// Юнит-тест чистого предиката гейта (prod-readiness аудит: штатный
// `npm run test:e2e` без предохранителя писал в боевую БД через service-role).
// Контракт: opt-in флаг обязателен, И он не спасает, если конфиг указывает на прод.
import { describe, it, expect } from "vitest";
import { isStatefulE2eAllowed, PROD_DB_REF } from "./stateful-gate";

describe("isStatefulE2eAllowed", () => {
  const nonProdEnv = {
    ALLOW_STATEFUL_E2E: "1",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
    DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  };

  it("true: флаг выставлен и БД не прод", () => {
    expect(isStatefulE2eAllowed(nonProdEnv)).toBe(true);
  });

  it("false: флаг не выставлен, даже на не-прод БД", () => {
    expect(isStatefulE2eAllowed({ ...nonProdEnv, ALLOW_STATEFUL_E2E: undefined })).toBe(false);
    expect(isStatefulE2eAllowed({ ...nonProdEnv, ALLOW_STATEFUL_E2E: "0" })).toBe(false);
  });

  it("false: флаг выставлен, но DATABASE_URL указывает на прод-ref (флаг не спасает)", () => {
    expect(
      isStatefulE2eAllowed({
        ...nonProdEnv,
        DATABASE_URL: `postgresql://postgres.${PROD_DB_REF}:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
      }),
    ).toBe(false);
  });

  it("false: флаг выставлен, но DIRECT_URL указывает на прод-ref (флаг не спасает)", () => {
    expect(
      isStatefulE2eAllowed({
        ...nonProdEnv,
        DIRECT_URL: `postgresql://postgres.${PROD_DB_REF}:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
      }),
    ).toBe(false);
  });

  it("true: флаг выставлен, DATABASE_URL/DIRECT_URL не заданы (нет прод-ref — не блокируем сами по себе)", () => {
    expect(isStatefulE2eAllowed({ ALLOW_STATEFUL_E2E: "1" })).toBe(true);
  });
});
