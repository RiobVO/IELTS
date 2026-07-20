import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NINE — IELTS Platform",
  description: "Premium IELTS preparation — Reading & Listening core.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
