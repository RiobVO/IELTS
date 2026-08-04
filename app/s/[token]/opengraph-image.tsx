/**
 * og:image расшаренной band-карточки (G1-5) — то, что реально видит человек в
 * ленте Telegram. Next-конвенция: файл рядом со страницей автоматически становится
 * её og:image/twitter:image.
 *
 * Runtime — NODE (не edge, в отличие от корневого app/opengraph-image.tsx):
 * картинка читает попытку из Postgres через Drizzle, а postgres-js на edge не живёт.
 *
 * Шрифт грузим с диска, но НЕ делаем его условием жизни: если файл не доехал до
 * бандла, Satori отрисует дефолтным — брендовая типографика приятна, а отсутствие
 * превью у расшаренной ссылки убивает саму фичу. Промах логируем.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { logError } from "@/lib/monitoring/log-error";
import { shareScoreCaption, shareScoreLabel } from "@/lib/result/share-card";
import { loadShareCard } from "./page";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "IELTS result card";

const GRADIENT_FROM = "#211B33";
const GRADIENT_TO = "#0E0B17";
const MARK_ACCENT = "#8B5CF6";

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const file = await readFile(
      path.join(process.cwd(), "app", "_og", "plus-jakarta-sans-extrabold.ttf"),
    );
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  } catch (e) {
    // Recover: рендерим дефолтным шрифтом. Логируем, чтобы регресс бандла было
    // видно, а не «карточка почему-то выглядит иначе».
    await logError({
      source: "server",
      message: `share og font load failed: ${e instanceof Error ? e.message : String(e)}`,
      context: { op: "shareOgFont" },
    });
    return null;
  }
}

export default async function ShareOgImage({ params }: { params: { token: string } }) {
  const [card, fontData] = await Promise.all([loadShareCard(params.token), loadFont()]);
  const fonts = fontData
    ? [{ name: "Plus Jakarta Sans", data: fontData, weight: 800 as const, style: "normal" as const }]
    : undefined;
  const fontFamily = fontData ? "Plus Jakarta Sans" : undefined;

  // Невалидный/отозванный токен: отдаём нейтральную брендовую плашку, а не 404 —
  // «битая картинка» в чате выглядит как сломанный продукт.
  if (!card) {
    return new ImageResponse(
      (
        <div style={{ ...S.canvas, fontFamily }}>
          <div style={S.title}>bando</div>
          <div style={S.sub}>IELTS Reading &amp; Listening</div>
        </div>
      ),
      { ...size, ...(fonts ? { fonts } : {}) },
    );
  }

  const score = shareScoreLabel(card.band, card.correctPct);
  const caption = shareScoreCaption(card.band);
  const skill = card.section === "listening" ? "Listening" : "Reading";

  return new ImageResponse(
    (
      <div style={{ ...S.canvas, fontFamily }}>
        <div style={S.head}>
          <svg width="52" height="52" viewBox="0 0 64 64" fill="none">
            <rect x="9" y="18" width="34" height="9" rx="4.5" fill={MARK_ACCENT} />
            <rect x="9" y="31" width="46" height="9" rx="4.5" fill="#FFFFFF" opacity={0.92} />
            <rect x="9" y="44" width="22" height="9" rx="4.5" fill="#FFFFFF" opacity={0.5} />
          </svg>
          <div style={S.headText}>bando · IELTS {skill}</div>
        </div>

        <div style={S.scoreRow}>
          <div style={S.score}>{score}</div>
          <div style={S.caption}>{caption}</div>
        </div>

        <div style={S.test}>{card.testTitle}</div>

        <div style={S.weakBox}>
          <div style={S.weakKey}>{card.weakLabel ? "WEAKEST QUESTION TYPE" : "RESULT"}</div>
          <div style={S.weakVal}>{card.weakLabel ?? "Every question type clean"}</div>
        </div>

        <div style={S.foot}>bando.study · find the type costing you points</div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}

// Satori понимает подмножество CSS: у каждого контейнера с детьми обязан быть
// явный display:flex, переменные и currentColor не поддерживаются.
const S: Record<string, React.CSSProperties> = {
  canvas: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "64px 72px",
    background: `linear-gradient(180deg, ${GRADIENT_FROM} 0%, ${GRADIENT_TO} 100%)`,
    color: "#FFFFFF",
  },
  head: { display: "flex", alignItems: "center", gap: 18 },
  headText: { display: "flex", fontSize: 30, fontWeight: 800, color: "rgba(255,255,255,0.78)" },
  scoreRow: { display: "flex", alignItems: "flex-end", gap: 22, marginTop: 34 },
  score: { display: "flex", fontSize: 150, fontWeight: 800, lineHeight: 1, letterSpacing: -4 },
  caption: { display: "flex", fontSize: 30, fontWeight: 800, color: MARK_ACCENT, paddingBottom: 18 },
  test: { display: "flex", fontSize: 34, fontWeight: 800, color: "rgba(255,255,255,0.82)", marginTop: 12 },
  weakBox: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 38,
    padding: "26px 30px",
    borderRadius: 22,
    background: "rgba(139,92,246,0.16)",
    border: "2px solid rgba(139,92,246,0.42)",
  },
  weakKey: { display: "flex", fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.6)" },
  weakVal: { display: "flex", fontSize: 46, fontWeight: 800 },
  foot: { display: "flex", fontSize: 24, fontWeight: 800, color: "rgba(255,255,255,0.5)", marginTop: 42 },
  title: { display: "flex", fontSize: 96, fontWeight: 800 },
  sub: { display: "flex", fontSize: 34, fontWeight: 800, color: "rgba(255,255,255,0.6)", marginTop: 12 },
};
