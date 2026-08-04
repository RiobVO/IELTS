import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/env";

// Только публичные (не /app, /admin, /auth) страницы — сверено с app/*/page.tsx.
// `/predictor` — публичный верх воронки (G1-6); `/s/<token>` сюда НЕ идёт: это
// приватные по смыслу карточки конкретных попыток, индексировать их незачем.
const PUBLIC_PATHS = ["", "/predictor", "/about", "/pricing", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = publicSiteUrl();
  if (!site) return [];
  return PUBLIC_PATHS.map((path) => ({
    url: `${site}${path}`,
    lastModified: new Date(),
  }));
}
