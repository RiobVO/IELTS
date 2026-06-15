"use client";

import { useState } from "react";

export default function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable (e.g. insecure context) — the user
      // can still select the read-only field manually.
    }
  }

  return (
    <div style={S.row}>
      <input value={url} readOnly onFocus={(e) => e.target.select()} style={S.input} />
      <button type="button" onClick={copy} style={S.btn}>
        {copied ? "Скопировано!" : "Скопировать"}
      </button>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  row: { display: "flex", gap: ".5rem", margin: ".75rem 0" },
  input: {
    flex: 1,
    minWidth: 0,
    padding: ".7rem .8rem",
    border: "1px solid #ececf1",
    borderRadius: 10,
    fontSize: ".9rem",
    background: "#fafafa",
    color: "#333",
    fontFamily: "inherit",
  },
  btn: {
    padding: ".7rem 1.1rem",
    border: "none",
    borderRadius: 10,
    background: "#6C5CE7",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  },
};
