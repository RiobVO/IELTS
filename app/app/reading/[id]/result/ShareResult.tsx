"use client";

import { useState } from "react";
import { Button, type ButtonVariant } from "@/components/core/Button";
import { createShareLink } from "./share-actions";

/**
 * Share the result to Telegram (W1-5 viral loop, band card G1-5). Uses the native
 * t.me share URL — no bot, no token, no new deps. Telegram is the #1 channel for
 * the UZ audience.
 *
 * G1-5: the shared link is now the attempt's public band card (`/s/<token>`), so
 * the message unfurls with a real preview — band + weakest type — instead of a
 * generic landing thumbnail. The card's own CTA carries the referral code (its
 * server knows the owner's), so a friend who signs up through it still ties back
 * into the referral reward.
 *
 * Fallback: if issuing the token fails (offline, transient DB error), we fall back
 * to the previous plain landing link with `?ref=` — a viral button must never
 * dead-end on a perk failing. The link is opened in the SAME click handler after
 * an await, so mobile Safari may treat it as a popup; hence window.open is called
 * with the resolved URL and the button shows a pending state meanwhile.
 */
export function ShareResult({
  refCode,
  headline,
  attemptId,
  variant = "secondary",
  fullWidth = true,
}: {
  refCode: string;
  headline: string;
  /** Попытка, чью карточку показываем. Токен выдаёт server action (owner-гейт). */
  attemptId: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
}) {
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    let url = `${location.origin}/?ref=${encodeURIComponent(refCode)}&src=share_link`;
    try {
      const cardUrl = await createShareLink(attemptId);
      if (cardUrl) url = cardUrl;
    } finally {
      setPending(false);
    }
    const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(headline)}`;
    window.open(tg, "_blank", "noopener,noreferrer");
  };

  return (
    <Button
      variant={variant}
      fullWidth={fullWidth}
      icon="share-2"
      onClick={onClick}
      disabled={pending}
    >
      {pending ? "Preparing…" : "Share on Telegram"}
    </Button>
  );
}
