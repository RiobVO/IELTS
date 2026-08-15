import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/env";

// Публичный краулинг открыт везде, кроме авторизованных/служебных зон.
// sitemap-ссылка появляется только когда известен канонический origin.
export default function robots(): MetadataRoute.Robots {
  const site = publicSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app/", "/admin/", "/api/", "/auth/"],
    },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
