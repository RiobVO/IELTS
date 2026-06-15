"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Имитируем callback провайдера. В тело шлём ТОЛЬКО идемпотентный ключ —
// сумму/тариф/срок/владельца сервер берёт из своей PENDING-строки, телу не доверяет.
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
      // Подписка продлена вебхуком — перезагружаем серверный стейт страницы.
      router.refresh();
    } catch (err) {
      // Ошибку показываем пользователю, не глотаем: песочница должна быть видимой.
      setState("error");
      setMessage(err instanceof Error ? err.message : "Не удалось завершить платёж");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={simulate}
        disabled={state === "loading"}
        style={btn}
      >
        {state === "loading" ? "Обработка…" : "Оплатить (тест)"}
      </button>
      {state === "error" && (
        <p role="alert" style={errorBox}>
          {message}
        </p>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  width: "100%",
  padding: ".8rem",
  border: "none",
  borderRadius: 10,
  background: "#6C5CE7",
  color: "#fff",
  fontWeight: 700,
  fontSize: "1rem",
  cursor: "pointer",
};
const errorBox: React.CSSProperties = {
  background: "#fdecec",
  color: "#a11",
  padding: ".6rem .75rem",
  borderRadius: 8,
  fontSize: ".85rem",
  marginTop: ".75rem",
};
