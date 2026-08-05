"use client";

/**
 * Подключение студенческого бота (G2-1) — клиентский островок в тихой секции
 * профиля.
 *
 * Ссылку НЕ открываем через window.open после await: мобильные блокировщики глушат
 * окно, открытое вне жеста пользователя (ровно этот баг ловили в share-кнопке
 * волны 1). Вместо этого показываем настоящую ссылку — пользователь жмёт её сам.
 */
import { useState } from "react";
import { Button } from "@/components/core/Button";
import { Icon } from "@/components/core/icons";
import { connectTelegram, disconnectTelegram } from "./actions";

export function TelegramConnect({ linked }: { linked: boolean }) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const connect = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await connectTelegram();
    setPending(false);
    if (res.ok) {
      setDeepLink(res.deepLink);
      return;
    }
    setError(
      res.reason === "unavailable"
        ? "Telegram reminders aren't switched on yet."
        : "Couldn't create your link. Try again in a moment.",
    );
  };

  const disconnect = async () => {
    if (pending) return;
    setPending(true);
    await disconnectTelegram();
    setPending(false);
    setDeepLink(null);
  };

  if (linked) {
    return (
      <div style={S.wrap}>
        <span style={S.linked}>
          <Icon name="circle-check" size={16} strokeWidth={2.4} /> Connected
        </span>
        <Button variant="secondary" size="sm" onClick={disconnect} disabled={pending}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (deepLink) {
    return (
      <div style={S.wrap}>
        <a href={deepLink} target="_blank" rel="noopener noreferrer" style={S.link}>
          Open Telegram and tap Start →
        </a>
        <span style={S.hint}>The link works for 15 minutes.</span>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <Button variant="secondary" size="sm" onClick={connect} disabled={pending}>
        {pending ? "Preparing…" : "Connect Telegram"}
      </Button>
      {error && <span style={S.error}>{error}</span>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  linked: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    color: "var(--success-text)",
  },
  link: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    color: "var(--text-link)",
    textDecoration: "none",
  },
  hint: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)" },
  error: { fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--error-text)" },
};
