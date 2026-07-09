import { Button } from "@/components/core/Button";

/**
 * Глобальный 404 App Router. Серверный компонент (нет состояния/эффектов) —
 * стиль консистентен с app/error.tsx: тот же центрированный минимализм и
 * токены дизайн-системы.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-extrabold)",
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          margin: 0,
          maxWidth: 420,
        }}
      >
        The page you are looking for does not exist or has moved.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Button variant="primary" href="/">
          Go home
        </Button>
        <Button variant="secondary" href="/app">
          Open the app
        </Button>
      </div>
    </div>
  );
}
