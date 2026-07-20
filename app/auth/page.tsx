import { signIn, signUp } from "./actions";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
    ref?: string;
  }>;
}) {
  const sp = await searchParams;

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
      <div style={{ width: "100%", maxWidth: 360 }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Вход</h1>
        <p style={{ color: "#666", margin: "0 0 1.25rem" }}>
          NINE — IELTS. Войдите по email или зарегистрируйтесь.
        </p>

        {sp.error && (
          <p
            role="alert"
            style={{
              background: "#fdecec",
              color: "#a11",
              padding: "0.6rem 0.75rem",
              borderRadius: 8,
              fontSize: ".9rem",
            }}
          >
            {sp.error}
          </p>
        )}
        {sp.message && (
          <p
            style={{
              background: "#eafaef",
              color: "#137a3a",
              padding: "0.6rem 0.75rem",
              borderRadius: 8,
              fontSize: ".9rem",
            }}
          >
            {sp.message}
          </p>
        )}

        {sp.ref && (
          <p
            style={{
              background: "#f1eefe",
              color: "#4b3fb0",
              padding: "0.6rem 0.75rem",
              borderRadius: 8,
              fontSize: ".9rem",
            }}
          >
            Регистрация по приглашению — ты и пригласивший получите бонус.
          </p>
        )}

        <form style={{ display: "grid", gap: "0.75rem", marginTop: "0.5rem" }}>
          <input type="hidden" name="next" value={sp.next ?? "/app"} />
          <input type="hidden" name="ref" value={sp.ref ?? ""} />
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            style={inputStyle}
          />
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            placeholder="Пароль (мин. 6 символов)"
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button type="submit" formAction={signIn} style={primaryBtn}>
              Войти
            </button>
            <button type="submit" formAction={signUp} style={ghostBtn}>
              Регистрация
            </button>
          </div>
        </form>

        <p style={{ color: "#999", fontSize: ".8rem", marginTop: "1rem" }}>
          Apple / Facebook — подключим, когда будут OAuth-ключи (§10).
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.7rem 0.8rem",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: "1rem",
};
const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: "0.7rem",
  border: "none",
  borderRadius: 8,
  background: "#6C5CE7",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  flex: 1,
  padding: "0.7rem",
  border: "1px solid #ddd",
  borderRadius: 8,
  background: "#fff",
  color: "#222",
  fontWeight: 600,
  cursor: "pointer",
};
