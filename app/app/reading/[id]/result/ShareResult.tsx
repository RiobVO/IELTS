"use client";

import { Button, type ButtonVariant } from "@/components/core/Button";

/**
 * Share the result to Telegram (W1-5 viral loop). Uses the native t.me share URL
 * — no bot, no token, no new deps. The shared link carries the user's referral
 * code (?ref=...), so a friend who signs up through it ties back into the
 * referral reward (2C). Telegram is the #1 channel for the UZ audience.
 *
 * variant/fullWidth default to the original full-width secondary card usage;
 * the coach hero passes a compact secondary button instead (inline action row).
 */
export function ShareResult({
  refCode,
  headline,
  variant = "secondary",
  fullWidth = true,
}: {
  refCode: string;
  headline: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
}) {
  const onClick = () => {
    const url = `${location.origin}/?ref=${encodeURIComponent(refCode)}`;
    const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(headline)}`;
    window.open(tg, "_blank", "noopener,noreferrer");
  };
  return (
    <Button variant={variant} fullWidth={fullWidth} icon="share-2" onClick={onClick}>
      Share on Telegram
    </Button>
  );
}
