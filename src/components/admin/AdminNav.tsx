"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * AdminNav — общий таб-бар для всех роутов /admin. До него пять админ-страниц
 * не были связаны навигацией (доступ только вводом URL / deep-link из бота).
 * Активный таб детектится по pathname; hover/active/focus — через инжект <style>
 * (breakpoint-свойств нет, таб-строка просто скроллится по горизонтали на узком).
 */
const TABS = [
  { href: "/admin", label: "Content" },
  { href: "/admin/writing", label: "Writing" },
  { href: "/admin/speaking", label: "Speaking" },
  { href: "/admin/vocabulary", label: "Vocabulary" },
  { href: "/admin/errors", label: "Errors" },
] as const;

// z-index 30 = уровень sticky-хедера приложения (см. tokens/base.css).
const CSS = `
.adm-nav{position:sticky;top:0;z-index:30;background:var(--surface);border-bottom:1px solid var(--border)}
.adm-nav__in{max-width:820px;margin:0 auto;display:flex;align-items:center;gap:18px;padding:10px 18px}
.adm-nav__brand{font-family:var(--font-ui);font-weight:800;font-size:var(--text-sm);letter-spacing:var(--tracking-tight);color:var(--text-primary);white-space:nowrap}
.adm-nav__brand b{color:var(--brand)}
.adm-nav__tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}
.adm-nav__tabs::-webkit-scrollbar{display:none}
.adm-tab{font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;color:var(--text-muted);text-decoration:none;padding:7px 12px;border-radius:var(--radius-full);white-space:nowrap;transition:background var(--duration-fast) var(--ease-standard),color var(--duration-fast) var(--ease-standard)}
.adm-tab:hover{background:var(--surface-hover);color:var(--text-primary)}
.adm-tab[aria-current="page"]{background:var(--brand-subtle);color:var(--text-link);box-shadow:inset 0 0 0 1px var(--brand-border)}
.adm-tab:focus-visible{outline:none;box-shadow:var(--ring)}
`;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <>
      <style>{CSS}</style>
      <header className="adm-nav">
        <div className="adm-nav__in">
          <span className="adm-nav__brand">
            <b>bando</b> admin
          </span>
          <nav className="adm-nav__tabs" aria-label="Admin sections">
            {TABS.map((t) => {
              // /admin — точное совпадение (иначе оно префикс всех остальных).
              const active =
                t.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === t.href || pathname.startsWith(t.href + "/");
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className="adm-tab"
                  aria-current={active ? "page" : undefined}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
    </>
  );
}
