import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { posthogConfig, publicSiteUrl } from "@/env";
import { PostHogProvider } from "@/lib/analytics/provider";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Literata (--font-literata) намеренно НЕ здесь: serif нужен только внутри /app
// (пассажи/результаты) и грузится в app/app/layout.tsx — публичные страницы
// (лендинг/auth/pricing) не прелоадят его 6 woff2-файлов.
// Manrope вместо Plus Jakarta Sans: у PJS строчная «g» длинным хвостом-крюком
// подныривает под соседние буквы на любых весах, а альтернативной формы g в
// шрифте нет (проверены ss01/ss02/cv01–cv04/salt). Решение владельца 2026-07-11.
const manrope = Manrope({
  subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jbmono", display: "swap",
});

const siteUrl = publicSiteUrl();
const title = "Get your band | bando";
const description = "Premium IELTS Reading & Listening prep: real exam mode, per-type analytics, and a clear path to your target band.";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  openGraph: {
    title,
    description,
    siteName: "bando",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

// viewport-fit=cover — корректные safe-area insets на телефонах с вырезом/закруглениями.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const analytics = posthogConfig();
  return (
    <html lang="en" className={`${manrope.variable} ${jbMono.variable}`}>
      <body>
        {analytics ? <PostHogProvider config={analytics}>{children}</PostHogProvider> : children}
        <SpeedInsights />
      </body>
    </html>
  );
}
