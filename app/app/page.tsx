import { getProfile, requireUser } from "@/lib/auth";
import { signOut } from "../auth/actions";

export default async function Dashboard() {
  await requireUser();
  const profile = await getProfile();

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1 style={{ fontSize: "1.6rem", margin: 0 }}>Дашборд</h1>
          <form action={signOut}>
            <button
              type="submit"
              style={{
                padding: "0.5rem 0.9rem",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Выйти
            </button>
          </form>
        </div>

        <p style={{ color: "#444", marginTop: "1rem" }}>
          Привет, <strong>{profile?.display_name ?? profile?.email}</strong>
        </p>
        <p style={{ color: "#777" }}>
          Роль: {profile?.role} · Тариф: {profile?.tier} · Рейтинг:{" "}
          {profile?.rating}
        </p>
        <p style={{ color: "#999", marginTop: "1.5rem" }}>
          Каталог, exam-режим и аналитика — следующие шаги (§9).
        </p>
      </div>
    </main>
  );
}
