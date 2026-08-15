import type { MetadataRoute } from "next";

// Цвета — токены лендинга (app/landing.css: --v, --bg).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "bando — Get your band",
    short_name: "bando",
    description:
      "Premium IELTS Reading & Listening prep: real exam mode, per-type analytics, and a clear path to your target band.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBFAFF",
    theme_color: "#8170EA",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
