import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAdmin();

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "3rem 1.5rem",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.6rem", margin: 0 }}>Admin</h1>
        <p style={{ color: "#777", marginTop: "0.75rem" }}>
          Вход разрешён: {profile.email} (role=admin).
        </p>
        <p style={{ color: "#999", marginTop: "1.5rem" }}>
          Загрузка HTML + теггинг — шаг 3 (§4.2.1).
        </p>
      </div>
    </main>
  );
}
