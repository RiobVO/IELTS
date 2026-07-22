"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/core/Button";

// Simulate a provider callback. The body carries ONLY the idempotency key — the
// server takes amount/tier/term/owner from its trusted PENDING row, never the body.
export default function SimulatePayment({
  provider,
  providerTransactionId,
}: {
  provider: string;
  providerTransactionId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function simulate() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch(`/api/webhooks/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerTransactionId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      // Surface the error — the sandbox should be visible, not silent.
      setState("error");
      setMessage(err instanceof Error ? err.message : "Payment could not be completed");
    }
  }

  return (
    <div>
      <Button onClick={simulate} loading={state === "loading"} size="lg" fullWidth trailingIcon="arrow-right">
        {state === "loading" ? "Processing…" : "Pay (test)"}
      </Button>
      {state === "error" && (
        <p role="alert" style={errorBox}>
          {message}
        </p>
      )}
    </div>
  );
}

const errorBox: React.CSSProperties = {
  background: "var(--error-subtle)",
  color: "var(--error-text)",
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  marginTop: 12,
};
