// Юнит-тест чистого предиката гейта (prod-readiness аудит: штатный
// `npm run test:e2e` без предохранителя писал в боевую БД через service-role).
// Контракт (волна 2, TESTING_PLAN.md §7 — hard guard): opt-in флаг ОБЯЗАТЕЛЕН,
// ВСЕ ЧЕТЫРЕ env-переменные (SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// DATABASE_URL, DIRECT_URL) обязаны быть заданы, ни одна не несёт прод-ref, и
// из всех четырёх извлекается ОДИН и тот же не-прод Supabase project ref —
// иначе гейт закрыт. e2e/admin.ts создаёt юзеров через SUPABASE_URL, поэтому
// он больше не может остаться непроверенным (была дыра).
import { describe, it, expect } from "vitest";
import { isStatefulE2eAllowed, statefulE2eBlockReason, supabaseRefFromUrl, PROD_DB_REF } from "./stateful-gate";

const TEST_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "zyxwvutsrqponmlkjihg";

// Локальное зеркало REQUIRED_VARS из stateful-gate.ts (там не экспортируется) —
// только чтобы пройтись циклом по всем четырём в decoy-тесте находки 1.
const REQUIRED_VARS_FOR_TEST = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL", "DIRECT_URL"] as const;

function poolerUrl(ref: string): string {
  return `postgresql://postgres.${ref}:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`;
}

function directUrl(ref: string): string {
  return `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`;
}

function httpsUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

const validEnv = {
  ALLOW_STATEFUL_E2E: "1",
  SUPABASE_URL: httpsUrl(TEST_REF),
  NEXT_PUBLIC_SUPABASE_URL: httpsUrl(TEST_REF),
  DATABASE_URL: poolerUrl(TEST_REF),
  DIRECT_URL: directUrl(TEST_REF),
};

describe("isStatefulE2eAllowed", () => {
  it("true: флаг + все четыре указывают на один не-прод ref", () => {
    expect(isStatefulE2eAllowed(validEnv)).toBe(true);
  });

  it("false: флаг не выставлен / \"0\", даже на валидном остальном конфиге", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, ALLOW_STATEFUL_E2E: undefined })).toBe(false);
    expect(isStatefulE2eAllowed({ ...validEnv, ALLOW_STATEFUL_E2E: "0" })).toBe(false);
  });

  describe("прод-ref в каждой из четырёх переменных по отдельности", () => {
    it("false: SUPABASE_URL несёт прод-ref (закрываемая дыра — admin.ts создаёт юзеров через неё)", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, SUPABASE_URL: httpsUrl(PROD_DB_REF) })).toBe(false);
    });

    it("false: NEXT_PUBLIC_SUPABASE_URL несёт прод-ref", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: httpsUrl(PROD_DB_REF) })).toBe(false);
    });

    it("false: DATABASE_URL несёт прод-ref", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, DATABASE_URL: poolerUrl(PROD_DB_REF) })).toBe(false);
    });

    it("false: DIRECT_URL несёт прод-ref", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, DIRECT_URL: directUrl(PROD_DB_REF) })).toBe(false);
    });
  });

  it("false: mismatch — SUPABASE_URL на ref A, DATABASE_URL на ref B", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, DATABASE_URL: poolerUrl(OTHER_REF) })).toBe(false);
  });

  it("false: localhost DATABASE_URL при hosted SUPABASE_URL (было true в старом контракте — перевёрнуто осознанно)", () => {
    expect(
      isStatefulE2eAllowed({
        ...validEnv,
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
        DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
      }),
    ).toBe(false);
  });

  it("false: отсутствует SUPABASE_URL", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, SUPABASE_URL: undefined })).toBe(false);
  });

  it("false: отсутствует DIRECT_URL", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, DIRECT_URL: undefined })).toBe(false);
  });

  it("false: пустая строка считается отсутствующей", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, SUPABASE_URL: "" })).toBe(false);
  });

  it("false: whitespace-only строка считается отсутствующей (находка 1)", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, SUPABASE_URL: "   " })).toBe(false);
  });

  it("false: mismatch — NEXT_PUBLIC_SUPABASE_URL на ref A, остальные на ref B", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: httpsUrl(OTHER_REF) })).toBe(false);
  });

  it("false: mismatch — DIRECT_URL на ref A, остальные на ref B", () => {
    expect(isStatefulE2eAllowed({ ...validEnv, DIRECT_URL: directUrl(OTHER_REF) })).toBe(false);
  });

  it("true: opaque-host (postgres:) uppercase ref лоуркейсится и равен https-варианту (находка 1)", () => {
    expect(
      isStatefulE2eAllowed({
        ...validEnv,
        DIRECT_URL: `postgresql://postgres:pw@db.${TEST_REF.toUpperCase()}.supabase.co:5432/postgres`,
      }),
    ).toBe(true);
  });

  describe("находка 2: SMOKE_BASE_URL должен быть не задан для stateful e2e", () => {
    it("false: SMOKE_BASE_URL задан (в т.ч. localhost) при валидной четвёрке", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, SMOKE_BASE_URL: "http://localhost:3000" })).toBe(false);
    });

    it("true: SMOKE_BASE_URL пустая строка не считается заданной", () => {
      expect(isStatefulE2eAllowed({ ...validEnv, SMOKE_BASE_URL: "" })).toBe(true);
    });
  });
});

describe("supabaseRefFromUrl", () => {
  it("извлекает ref из https-формата (project URL)", () => {
    expect(supabaseRefFromUrl(httpsUrl(TEST_REF))).toBe(TEST_REF);
  });

  it("извлекает ref из https-формата с портом/путём", () => {
    expect(supabaseRefFromUrl(`https://${TEST_REF}.supabase.co:443/auth/v1`)).toBe(TEST_REF);
  });

  it("извлекает ref из pooler-формата (username postgres.<ref>)", () => {
    expect(supabaseRefFromUrl(poolerUrl(TEST_REF))).toBe(TEST_REF);
  });

  it("извлекает ref из direct-формата (db.<ref>.supabase.co)", () => {
    expect(supabaseRefFromUrl(directUrl(TEST_REF))).toBe(TEST_REF);
  });

  it("null для localhost", () => {
    expect(supabaseRefFromUrl("postgresql://postgres:postgres@localhost:5432/postgres")).toBeNull();
  });

  it("null для произвольного https, не supabase.co", () => {
    expect(supabaseRefFromUrl("https://example.com/foo")).toBeNull();
  });

  it("null для пустой строки", () => {
    expect(supabaseRefFromUrl("")).toBeNull();
  });

  it("null для ref длиной 19 (короче прод-длины 20)", () => {
    expect(supabaseRefFromUrl(httpsUrl(TEST_REF.slice(0, 19)))).toBeNull();
  });

  it("null для ref длиной 21 (длиннее прод-длины 20)", () => {
    expect(supabaseRefFromUrl(httpsUrl(`${TEST_REF}x`))).toBeNull();
  });

  it("null для http:// (не https) project URL — находка 1", () => {
    expect(supabaseRefFromUrl(`http://${TEST_REF}.supabase.co`)).toBeNull();
  });

  it("null для pooler-хоста с суффиксом-приманкой (.pooler.supabase.com.evil)", () => {
    expect(supabaseRefFromUrl(`postgresql://postgres.${TEST_REF}:pw@aws-1.pooler.supabase.com.evil:6543/postgres`)).toBeNull();
  });

  it("извлекает ref из https с query-строкой (позитив на побочный эффект URL-парсинга)", () => {
    expect(supabaseRefFromUrl(`https://${TEST_REF}.supabase.co?region=test`)).toBe(TEST_REF);
  });

  it("извлекает ref из https с fragment'ом", () => {
    expect(supabaseRefFromUrl(`https://${TEST_REF}.supabase.co#frag`)).toBe(TEST_REF);
  });

  it("декодирует percent-encoded username пулера (postgres%2E<ref>)", () => {
    expect(
      supabaseRefFromUrl(`postgresql://postgres%2E${TEST_REF}:pw@aws-1.pooler.supabase.com:6543/postgres`),
    ).toBe(TEST_REF);
  });

  it("null (не throw) на битой percent-последовательности в username пулера", () => {
    expect(
      supabaseRefFromUrl(`postgresql://postgres.%E0%:pw@aws-1.pooler.supabase.com:6543/postgres`),
    ).toBeNull();
  });
});

describe("statefulE2eBlockReason", () => {
  it("null на happy path", () => {
    expect(statefulE2eBlockReason(validEnv)).toBeNull();
  });

  it("причина упоминает имя переменной на прод-ref", () => {
    const reason = statefulE2eBlockReason({ ...validEnv, SUPABASE_URL: httpsUrl(PROD_DB_REF) });
    expect(reason).not.toBeNull();
    expect(reason).toContain("SUPABASE_URL");
  });

  it("причина на mismatch содержит оба ref", () => {
    const reason = statefulE2eBlockReason({ ...validEnv, DATABASE_URL: poolerUrl(OTHER_REF) });
    expect(reason).not.toBeNull();
    expect(reason).toContain(TEST_REF);
    expect(reason).toContain(OTHER_REF);
  });

  describe("находка 1: полный decoy-bypass из внешнего ревью", () => {
    // Прод-хост спрятан trailing dot'ом + UPPERCASE, приманка — рабочий
    // pooler-паттерн в query-строке. Старый неанкерованный regex вытаскивал
    // ref из приманки вместо прод-хоста; фикс обязан блокировать по
    // case-insensitive substring прод-ref раньше, чем дойдёт до парсинга URL.
    const httpsDecoy =
      "https://OYECQBVEATKOLBQGFCZQ.supabase.co./?x=://postgres.abcdefghijklmnopqrst:pw@aws-1.pooler.supabase.com";
    const pgDecoy =
      "postgresql://postgres:pw@db.OYECQBVEATKOLBQGFCZQ.supabase.co.:5432/postgres?x=://postgres.abcdefghijklmnopqrst:pw@aws-1.pooler.supabase.com";

    const decoyByVar: Record<(typeof REQUIRED_VARS_FOR_TEST)[number], string> = {
      SUPABASE_URL: httpsDecoy,
      NEXT_PUBLIC_SUPABASE_URL: httpsDecoy,
      DATABASE_URL: pgDecoy,
      DIRECT_URL: pgDecoy,
    };

    for (const name of REQUIRED_VARS_FOR_TEST) {
      it(`false: ${name} несёт decoy-URL с трейлинг-dot прод-хостом`, () => {
        const reason = statefulE2eBlockReason({ ...validEnv, [name]: decoyByVar[name] });
        expect(reason).not.toBeNull();
        expect(reason!.toLowerCase()).toContain(PROD_DB_REF);
      });
    }
  });

  it("false: прод-ref в UPPERCASE внутри пароля/query (case-insensitive substring)", () => {
    const reason = statefulE2eBlockReason({
      ...validEnv,
      DATABASE_URL: `postgresql://postgres.${TEST_REF}:${PROD_DB_REF.toUpperCase()}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
    });
    expect(reason).not.toBeNull();
    expect(reason).toContain("DATABASE_URL");
  });

  it("причина на SMOKE_BASE_URL упоминает переменную (находка 2)", () => {
    const reason = statefulE2eBlockReason({ ...validEnv, SMOKE_BASE_URL: "http://localhost:3000" });
    expect(reason).not.toBeNull();
    expect(reason).toContain("SMOKE_BASE_URL");
  });
});
