import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/env";

// Только публичные (не /app, /admin, /auth) страницы — сверено с app/*/page.tsx.
const PUBLIC_PATHS = ["", "/about", "/pricing", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = publicSiteUrl();
  if (!site) return [];
  return PUBLIC_PATHS.map((path) => ({
    url: `${site}${path}`,
    lastModified: new Date(),
  }));
}
