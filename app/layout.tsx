import type { Metadata } from "next";
import "./globals.css";
import { posthogConfig } from "@/env";
import { PostHogProvider } from "@/lib/analytics/provider";

export const metadata: Metadata = {
  title: "NINE — IELTS Platform",
  description: "Premium IELTS preparation — Reading & Listening core.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Аналитика опциональна (§11): без ключа провайдер не монтируется — fail-open.
  const analytics = posthogConfig();
  return (
    <html lang="en">
      <body>
        {analytics ? (
          <PostHogProvider config={analytics}>{children}</PostHogProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
