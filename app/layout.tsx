import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Literata, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { posthogConfig } from "@/env";
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

export const metadata: Metadata = {
  title: "bando — Get your band",
  description: "Premium IELTS Reading & Listening prep: real exam mode, per-type analytics, and a clear path to your target band.",
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
