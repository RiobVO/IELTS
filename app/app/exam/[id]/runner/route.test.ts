// Гейт runner route — defense-in-depth границы на прямой GET /runner (Codex-ревью
// волны 0063): ошибка условия здесь выдала бы gated runner-HTML без тира. Рендер
// (renderRunnerDocument) не мокается — контракт «нет <head> → 500» и байт-в-байт
// пайплайн покрыты render-runner.test.ts, тут только минимальный валидный документ.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUserMock, isAdminMock, selectMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  isAdminMock: vi.fn(),
  selectMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUser: getUserMock, isAdminProfile: isAdminMock }));
vi.mock("@/db", () => ({ db: { select: selectMock } }));
// env читается на загрузке модуля (SUPABASE_MEDIA_ORIGIN) — без мока модуль не соберётся.
vi.mock("@/env", () => ({ env: { SUPABASE_URL: "https://stub.supabase.co" } }));
import { GET } from "./route";

const ID = "11111111-1111-1111-1111-111111111111";
const MINIMAL_HTML = "<html><head></head><body></body></html>";

// Чейны повторяют формы запросов роута: prof/item -> .from().where();
// att -> .from().where().orderBy().limit().
const whereChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const attChain = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
});

function mockRows(args: {
  profile?: { tier: string; premiumUntil: Date | null; role: string } | null;
  item: { tierRequired: string; category: string; html: string | null; status: string; durationSeconds: number | null } | null;
}) {
  selectMock
    .mockReturnValueOnce(whereChain(args.profile ? [args.profile] : []))
    .mockReturnValueOnce(whereChain(args.item ? [args.item] : []))
    .mockReturnValueOnce(attChain([]));
}

function get(): Promise<Response> {
  return GET(new Request(`https://x.test/app/exam/${ID}/runner`), {
    params: Promise.resolve({ id: ID }),
  });
}

beforeEach(() => {
  [getUserMock, isAdminMock, selectMock].forEach((m) => m.mockReset());
  getUserMock.mockResolvedValue({ id: "u1" });
  isAdminMock.mockReturnValue(false);
});

describe("runner route — tier-гейт (0063: без trial-лейна)", () => {
  it("Basic + published premium-тест -> 403, HTML не отдаётся", async () => {
    mockRows({
      profile: { tier: "basic", premiumUntil: null, role: "student" },
      item: { tierRequired: "premium", category: "full_reading", html: MINIMAL_HTML, status: "published", durationSeconds: null },
    });
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("черновик + НЕ-админ -> 404 (не палим существование)", async () => {
    mockRows({
      profile: { tier: "ultra", premiumUntil: null, role: "student" },
      item: { tierRequired: "basic", category: "passage_1", html: MINIMAL_HTML, status: "draft", durationSeconds: null },
    });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it("черновик + админ -> bypass тир-гейта (F4), 200 даже при tier ниже required", async () => {
    isAdminMock.mockReturnValue(true);
    mockRows({
      profile: { tier: "basic", premiumUntil: null, role: "admin" },
      item: { tierRequired: "ultra", category: "full_reading", html: MINIMAL_HTML, status: "draft", durationSeconds: null },
    });
    const res = await get();
    expect(res.status).toBe(200);
  });

  it("Basic + published basic-тест -> 200 (свободный каталог)", async () => {
    mockRows({
      profile: { tier: "basic", premiumUntil: null, role: "student" },
      item: { tierRequired: "basic", category: "passage_1", html: MINIMAL_HTML, status: "published", durationSeconds: null },
    });
    const res = await get();
    expect(res.status).toBe(200);
  });
});
