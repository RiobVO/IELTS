"use client";

interface UnlockedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export default function BadgeUnlock({ badges }: { badges: UnlockedBadge[] }) {
  if (badges.length === 0) return null;

  const heading = badges.length === 1 ? "🎉 Новый бейдж!" : "🎉 Новые бейджи!";

  return (
    <section style={S.section}>
      <div style={S.heading}>{heading}</div>
      <div style={S.row}>
        {badges.map((b, i) => (
          <div
            key={b.id}
            className="badge-unlock"
            style={{ ...S.card, animationDelay: `${i * 0.12}s` }}
          >
            <div style={S.icon}>{b.icon ?? "🏅"}</div>
            <div style={S.name}>{b.name}</div>
            {b.description && <div style={S.desc}>{b.description}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  section: {
    marginTop: "1rem",
    background: "#f4f2ff",
    border: "1px solid #ddd6fe",
    borderRadius: 14,
    padding: "1rem",
    textAlign: "center",
  },
  heading: {
    fontWeight: 800,
    color: "#6C5CE7",
    fontSize: "1.05rem",
    marginBottom: ".75rem",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: ".6rem",
    justifyContent: "center",
  },
  card: {
    background: "#fff",
    border: "1px solid #ececf1",
    borderRadius: 12,
    padding: "1rem .9rem",
    minWidth: 130,
    maxWidth: 170,
    textAlign: "center",
  },
  icon: { fontSize: "2.4rem", lineHeight: 1 },
  name: { fontWeight: 700, fontSize: ".95rem", marginTop: ".5rem" },
  desc: {
    color: "#888",
    fontSize: ".76rem",
    marginTop: ".3rem",
    lineHeight: 1.4,
  },
};
