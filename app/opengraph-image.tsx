// Next.js file convention: авто-подхватывается как og:image/twitter:image для всех
// страниц с дефолтным generateMetadata (без ручной прописки в metadata).
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Градиент фона — тот же, что у плитки-тайла (brand-kit/bando-mark.svg), растянут на весь canvas.
const GRADIENT_FROM = "#211B33";
const GRADIENT_TO = "#0E0B17";
// Геометрия и цвета знака — как в public/bando-mark.svg (standalone-вариант без тайла):
// первый брусок — фиолетовый акцент, остальные два — белый с opacity (currentColor тут не работает,
// ImageResponse/Satori не поддерживает CSS-переменные и currentColor).
const MARK_ACCENT = "#8B5CF6";

export default async function OpengraphImage() {
  // Статический TTF, не variable font: Satori падает на fvar-таблице variable-шрифтов.
  // Файл лежит в репо и грузится relative-фетчем (edge runtime, fs недоступен) — без
  // рантайм-похода на серверы Google Fonts, поэтому не хрупко и работает офлайн.
  const fontData = await fetch(
    new URL("./_og/plus-jakarta-sans-extrabold.ttf", import.meta.url)
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(180deg, ${GRADIENT_FROM} 0%, ${GRADIENT_TO} 100%)`,
        }}
      >
        <div style={{ display: "flex" }}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="9" y="18" width="34" height="9" rx="4.5" fill={MARK_ACCENT} />
            <rect x="9" y="31" width="46" height="9" rx="4.5" fill="#FFFFFF" opacity={0.92} />
            <rect x="9" y="44" width="22" height="9" rx="4.5" fill="#FFFFFF" opacity={0.5} />
          </svg>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 44,
            fontSize: 68,
            fontWeight: 800,
            color: "#FFFFFF",
            letterSpacing: -1.5,
            lineHeight: 1.15,
            textAlign: "center",
            fontFamily: "Plus Jakarta Sans",
          }}
        >
          <div style={{ display: "flex" }}>Get the band</div>
          <div style={{ display: "flex" }}>you're aiming for</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Plus Jakarta Sans", data: fontData, weight: 800, style: "normal" },
      ],
    }
  );
}
