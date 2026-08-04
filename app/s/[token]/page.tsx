/**
 * Публичная band-карточка результата (`/s/<token>`, G1-5).
 *
 * ПОЧЕМУ ПУБЛИЧНАЯ. Ссылку кидают в Telegram, а его краулер тянет страницу и
 * og:image БЕЗ сессии — под owner-гейтом превью было бы пустым прямоугольником, и
 * вся затея (расшаренная карточка как вход в воронку) не работала бы. Доступ даёт
 * неугадываемый токен (0060), который выдаётся только владельцу сданной попытки.
 *
 * ЧТО ВИДНО. band (или процент), название теста и слабейший тип вопросов. Ни
 * ответов, ни ключа, ни e-mail, ни имени владельца, ни id попытки.
 *
 * translate="no" — обязательный гейт для КАЖДОЙ новой поверхности вне /app
 * (готча про Google Translate: внешние DOM-мутации ломают React-реконсиляцию).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { Logo } from "@/components/core/Logo";
import { qtypeLabel } from "@/lib/labels";
import {
  shareDescription,
  shareScoreCaption,
  shareScoreLabel,
  shareTitle,
  weakestType,
  type ShareBreakdown,
} from "@/lib/result/share-card";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export interface ShareCardData {
  band: number | null;
  correctPct: number;
  testTitle: string;
  section: "reading" | "listening";
  weakLabel: string | null;
  /** Реф-код владельца — едет ТОЛЬКО в CTA этой страницы, не в саму ссылку. */
  refCode: string;
}

/**
 * Данные карточки по токену. Owner-path (Drizzle) — таблица `attempt` закрыта для
 * anon на уровне грантов, публичного чтения из браузера тут нет и быть не может.
 * Экспортируется, потому что тем же запросом живёт og-картинка соседнего файла.
 */
export async function loadShareCard(token: string): Promise<ShareCardData | null> {
  if (!isUuid(token)) return null;
  const [row] = await db
    .select({
      bandScore: attempt.bandScore,
      rawScore: attempt.rawScore,
      perTypeBreakdown: attempt.perTypeBreakdown,
      status: attempt.status,
      title: contentItem.title,
      section: contentItem.section,
      refCode: profile.referralCode,
    })
    .from(attempt)
    .innerJoin(contentItem, eq(contentItem.id, attempt.contentItemId))
    .innerJoin(profile, eq(profile.id, attempt.userId))
    .where(eq(attempt.shareToken, token))
    .limit(1);
  // Токен выдаётся только сданной попытке, но статус перепроверяем: попытку могли
  // бы переоткрыть будущей механикой, и карточка «в процессе» врала бы.
  if (!row || row.status !== "submitted") return null;

  const breakdown = row.perTypeBreakdown as ShareBreakdown;
  // Процент считаем из breakdown (raw_score один, без знаменателя, ничего не значит).
  let correct = 0;
  let total = 0;
  for (const v of Object.values(breakdown ?? {})) {
    if (!v || typeof v !== "object") continue;
    const c = Number(v.correct);
    const t = Number(v.total);
    if (!Number.isFinite(c) || !Number.isFinite(t)) continue;
    correct += c;
    total += t;
  }
  const weak = weakestType(breakdown);
  return {
    band: row.bandScore != null ? Number(row.bandScore) : null,
    correctPct: total > 0 ? Math.round((correct / total) * 100) : 0,
    testTitle: row.title,
    section: row.section as "reading" | "listening",
    weakLabel: weak ? qtypeLabel(weak) : null,
    refCode: row.refCode,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const card = await loadShareCard(token);
  // Несуществующий/отозванный токен не должен подсказывать, что тут вообще бывает:
  // нейтральные мета без единого факта о попытке.
  if (!card) return { title: "bando", description: "IELTS Reading & Listening practice." };
  const title = shareTitle(shareScoreLabel(card.band, card.correctPct), card.band);
  const description = shareDescription(card.testTitle, card.weakLabel);
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadShareCard(token);
  if (!card) notFound();

  const score = shareScoreLabel(card.band, card.correctPct);
  const caption = shareScoreCaption(card.band);
  const skill = card.section === "listening" ? "Listening" : "Reading";
  // Реф-код владельца в CTA: друг, пришедший по карточке, засчитывается в
  // реферальную награду обеим сторонам (G1-1). `src` отделяет этот канал в
  // атрибуции от постов в TG-каналах.
  const ctaHref = `/auth?ref=${encodeURIComponent(card.refCode)}&src=share_card`;

  return (
    <div translate="no" className="notranslate" style={S.screen}>
      <header style={S.head}>
        <a href="/" aria-label="bando home" style={{ display: "inline-flex", textDecoration: "none" }}>
          <Logo size={26} />
        </a>
        <a href={ctaHref} style={S.headCta}>Take a free test →</a>
      </header>

      <main style={S.main}>
        <div style={S.card}>
          <div aria-hidden="true" style={S.glow} />
          <div style={{ position: "relative" }}>
            <div style={S.eyebrow}>{skill} · {caption}</div>
            <div style={S.score}>{score}</div>
            <div style={S.test}>{card.testTitle}</div>
            {card.weakLabel ? (
              <div style={S.weakRow}>
                <span style={S.weakKey}>Weakest question type</span>
                <span style={S.weakVal}>{card.weakLabel}</span>
              </div>
            ) : (
              <div style={S.weakRow}>
                <span style={S.weakVal}>Every question type clean.</span>
              </div>
            )}
          </div>
        </div>

        <h1 style={S.h1}>Find out what&apos;s costing you points.</h1>
        <p style={S.lead}>
          bando scores every IELTS Reading and Listening question type on its own, in the same
          Inspera-style interface as the computer-delivered exam — so the one weakness dragging your
          band down is impossible to miss.
        </p>
        <a href={ctaHref} style={S.cta}>Take the free test</a>
        <p style={S.note}>No card needed. Your band in about 20 minutes.</p>
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  screen: { minHeight: "100dvh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", display: "flex", flexDirection: "column" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 24px", borderBottom: "1px solid var(--border)", background: "var(--surface)" },
  headCta: { fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-link)", textDecoration: "none" },
  main: { flex: 1, width: "100%", maxWidth: 620, margin: "0 auto", padding: "32px 22px 56px", textAlign: "center" },
  card: { position: "relative", overflow: "hidden", textAlign: "left", padding: 26, borderRadius: "var(--radius-xl)", background: "linear-gradient(160deg, var(--surface-premium), var(--surface-premium-deep))", color: "var(--surface-premium-ink)", boxShadow: "var(--shadow-lg)" },
  glow: { position: "absolute", top: -90, right: -70, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 50%, transparent), transparent 64%)" },
  eyebrow: { fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" },
  score: { fontFamily: "var(--font-mono)", fontSize: 64, fontWeight: 800, lineHeight: 1.05, margin: "6px 0 2px" },
  test: { fontSize: "var(--text-base)", fontWeight: 700, color: "rgba(255,255,255,0.86)" },
  weakRow: { display: "flex", flexDirection: "column", gap: 2, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.16)" },
  weakKey: { fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" },
  weakVal: { fontSize: "var(--text-lg)", fontWeight: 700 },
  h1: { fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "var(--tracking-tight)", margin: "34px 0 10px" },
  lead: { fontSize: "var(--text-base)", color: "var(--text-muted)", lineHeight: 1.55, margin: "0 auto 26px", maxWidth: 460 },
  cta: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "0 28px", borderRadius: "var(--radius-md)", background: "var(--brand-strong, var(--brand))", color: "#fff", fontSize: "var(--text-base)", fontWeight: 700, textDecoration: "none", boxShadow: "var(--shadow-md)" },
  note: { fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 14 },
};
