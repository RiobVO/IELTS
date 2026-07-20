import Link from "next/link";

// Краткое сравнение тарифов §4.8 для лендинга — без чисел лимитов (N подбираем
// при запуске), только позиционирование «free -> премиум».
const TIERS: { name: string; line: string; highlight?: boolean }[] = [
  { name: "Basic", line: "Бесплатно. Лимит тестов в день, базовый разбор." },
  {
    name: "Premium",
    line: "Безлимит, полный разбор с evidence, аналитика и история.",
    highlight: true,
  },
  { name: "Ultra", line: "Всё из Premium плюс AI-оценка Writing/Speaking (скоро)." },
];

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: "2rem",
      }}
    >
      <div style={{ maxWidth: 720, width: "100%" }}>
        <h1 style={{ fontSize: "2rem", margin: 0 }}>NINE — IELTS Platform</h1>
        <p style={{ color: "#666", marginTop: "0.75rem" }}>
          Подготовка к IELTS Reading и Listening: реальные тесты, мгновенная
          проверка, разбор по типам вопросов и прогресс с рейтингом.
        </p>

        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.25rem" }}>
          <Link href="/auth" style={primaryCta}>
            Начать бесплатно
          </Link>
          <Link href="/app/upgrade" style={ghostCta}>
            Тарифы
          </Link>
        </div>

        <h2 style={{ fontSize: "1.15rem", margin: "2.25rem 0 0.9rem" }}>
          Тарифы
        </h2>
        <div style={tierGrid}>
          {TIERS.map((t) => (
            <div
              key={t.name}
              style={{
                ...tierCard,
                ...(t.highlight ? tierCardHighlight : {}),
              }}
            >
              <div style={{ fontWeight: 800, color: "#5a44d6" }}>{t.name}</div>
              <p style={{ color: "#555", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
                {t.line}
              </p>
            </div>
          ))}
        </div>

        <p style={{ marginTop: "1.5rem" }}>
          <Link href="/auth" style={{ color: "#6C5CE7", fontWeight: 700 }}>
            Зарегистрироваться →
          </Link>
        </p>
      </div>
    </main>
  );
}

const primaryCta: React.CSSProperties = {
  padding: "0.7rem 1.2rem",
  background: "#6C5CE7",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 700,
};
const ghostCta: React.CSSProperties = {
  padding: "0.7rem 1.2rem",
  background: "#fff",
  color: "#6C5CE7",
  border: "1px solid #6C5CE7",
  borderRadius: 10,
  fontWeight: 700,
};
const tierGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "0.75rem",
};
const tierCard: React.CSSProperties = {
  border: "1px solid #ececf1",
  borderRadius: 14,
  padding: "1.1rem 1.2rem",
  background: "#fff",
};
const tierCardHighlight: React.CSSProperties = {
  borderColor: "#6C5CE7",
  boxShadow: "0 1px 8px rgba(108,92,231,.12)",
};
