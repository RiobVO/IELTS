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
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: "2rem", margin: 0 }}>NINE — IELTS Platform</h1>
        <p style={{ color: "#666", marginTop: "0.75rem" }}>
          Phase&nbsp;1 scaffold is up. Design and product surfaces land in later
          phases.
        </p>
        <p style={{ marginTop: "1rem" }}>
          API health check:{" "}
          <a href="/api/health" style={{ color: "#6C5CE7" }}>
            /api/health
          </a>
        </p>
      </div>
    </main>
  );
}
