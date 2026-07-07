import { describe, it, expect, vi, beforeEach } from "vitest";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { existsSync } = vi.hoisted(() => ({ existsSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync };
});

import { resolveSourceFile } from "./backfill-source-html";

const HERE = dirname(fileURLToPath(new URL("./backfill-source-html.ts", import.meta.url)));
const QA_IMPORT = join(HERE, "..", ".qa-import");
const DOWNLOADS = join(homedir(), "Downloads");
const TG_DESKTOP = join(DOWNLOADS, "Telegram Desktop");

beforeEach(() => {
  existsSync.mockReset();
});

describe("resolveSourceFile — маппинг sourceFilePath -> локальный файл", () => {
  it("null sourceFilePath -> null, existsSync не вызывается", () => {
    expect(resolveSourceFile(null)).toBeNull();
    expect(existsSync).not.toHaveBeenCalled();
  });

  it("буквальный путь существует -> берёт его (высший приоритет)", () => {
    existsSync.mockImplementation((p: string) => p === "C:\\abs\\test.html");
    expect(resolveSourceFile("C:\\abs\\test.html")).toBe("C:\\abs\\test.html");
  });

  it("буквального пути нет -> падает на .qa-import\\<basename>", () => {
    const name = "vol7-t3.html";
    existsSync.mockImplementation((p: string) => p === join(QA_IMPORT, name));
    // join, не литерал "C:\gone\..." — POSIX basename не режет обратные слэши (CI-раннер ubuntu)
    expect(resolveSourceFile(join("C:", "gone", name))).toBe(join(QA_IMPORT, name));
  });

  it("нет ни буквального, ни .qa-import -> падает на ~/Downloads\\<basename>", () => {
    const name = "listening-mock.html";
    existsSync.mockImplementation((p: string) => p === join(DOWNLOADS, name));
    expect(resolveSourceFile(name)).toBe(join(DOWNLOADS, name));
  });

  it("падает на ~/Downloads/Telegram Desktop\\<basename>, если раньше ничего не нашлось", () => {
    const name = "reading-full.html";
    existsSync.mockImplementation((p: string) => p === join(TG_DESKTOP, name));
    expect(resolveSourceFile(name)).toBe(join(TG_DESKTOP, name));
  });

  it("ничего не найдено ни в одном кандидате -> null", () => {
    existsSync.mockReturnValue(false);
    expect(resolveSourceFile("missing.html")).toBeNull();
  });

  it("голое имя (Telegram) сводится к basename для всех кандидатов", () => {
    const path = "some/tg/dir/file.html";
    existsSync.mockImplementation((p: string) => p === join(DOWNLOADS, basename(path)));
    expect(resolveSourceFile(path)).toBe(join(DOWNLOADS, "file.html"));
  });
});
