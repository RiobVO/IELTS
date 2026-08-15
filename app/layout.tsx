import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Literata, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { posthogConfig, publicSiteUrl } from "@/env";
import { PostHogProvider } from "@/lib/analytics/provider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap",
});
const literata = Literata({
  subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-literata", display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jbmono", display: "swap",
});

const siteUrl = publicSiteUrl();
const title = "bando: Get your band";
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
    <html lang="en" className={`${jakarta.variable} ${literata.variable} ${jbMono.variable}`}>
      <body>
        {analytics ? <PostHogProvider config={analytics}>{children}</PostHogProvider> : children}
      </body>
    </html>
  );
}
