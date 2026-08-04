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
      // `/s/` — расшаренные band-карточки (G1-5): ссылку кидают конкретным людям,
      // индексу она не нужна. Превью в мессенджерах это не мешает: краулеры
      // Telegram/WhatsApp читают og-теги, а не robots-разрешение на индексацию.
      disallow: ["/app/", "/admin/", "/api/", "/auth/", "/s/"],
    },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
