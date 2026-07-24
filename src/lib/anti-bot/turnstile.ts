/**
 * Cloudflare Turnstile verification (анти-бот на signup, BRIEF §11). SERVER-ONLY.
 *
 * Seam, like analytics/payments: when no keys are configured (`turnstileConfig()
 * === null`) the gate is OFF and every call returns true — signup keeps working
 * without a captcha (fail-open; the real control activates once Cloudflare keys
 * are added). When the gate is ON, a missing token is rejected, and a verify
 * error is fail-CLOSED (reject): if you deliberately turned the gate on, a
 * transient siteverify failure should not silently wave bots through.
 */
import { turnstileConfig } from "@/env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: string | null): Promise<boolean> {
  const cfg = turnstileConfig();
  if (!cfg) return true; // gate off — no keys configured
  if (!token) return false; // gate on, no token — reject

  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: cfg.secretKey, response: token }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    // Gate is ON but Cloudflare is unreachable — fail closed (reject), logged.
    console.error("verifyTurnstile failed", e);
    return false;
  }
}
