"use client";

import { useState } from "react";
import { Button } from "@/components/core/Button";

export default function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable (insecure context) — the user can still
      // select the read-only field manually.
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, margin: "14px 0 16px" }}>
      <input
        value={url}
        readOnly
        onFocus={(e) => e.target.select()}
        style={{ flex: 1, minWidth: 0, height: 50, padding: "0 14px", borderRadius: "var(--radius-md)", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
      />
      <Button variant={copied ? "success" : "primary"} icon={copied ? "check" : "arrow-right"} onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
