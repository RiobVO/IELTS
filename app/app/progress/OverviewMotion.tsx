"use client";

/**
 * Overview screen entrance motion (client island over server-rendered markup).
 * Everything is already at its final state in the DOM (chart lines fully drawn,
 * bars at their real width, numbers printed) — so SSR / no-JS / reduced-motion
 * show the real trajectory immediately. This only layers WAAPI entrance motion
 * via data attributes, same convention as LeagueMotion/BadgesMotion. Renders
 * nothing.
 */

import { useEffect } from "react";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Decimal-aware count-up (band figures are 0.5-stepped, e.g. "6.5" — the
 *  integer countUp used by League/Badges would clip the fraction). */
function countUp(el: HTMLElement, to: number, dur: number, decimals: number) {
  const factor = 10 ** decimals;
  let start = 0;
  const step = (now: number) => {
    if (!start) start = now;
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = (Math.round(eased * to * factor) / factor).toFixed(decimals);
    if (k < 1) requestAnimationFrame(step);
    else el.textContent = to.toFixed(decimals);
  };
  requestAnimationFrame(step);
}

export function OverviewMotion() {
  useEffect(() => {
    if (prefersReduced()) return;
    const root = document.querySelector<HTMLElement>("[data-overview-root]");
    if (!root) return;
    const anims: Animation[] = [];

    root.querySelectorAll<HTMLElement>("[data-countup]").forEach((el) => {
      const to = Number(el.dataset.countup);
      const decimals = Number(el.dataset.decimals ?? "0");
      if (Number.isFinite(to)) countUp(el, to, 900, decimals);
    });

    // Chart lines (combined/reading/listening) — draw-in via stroke-dashoffset.
    // Server renders the FINAL offset (0, fully drawn); the animation only
    // overlays a visual play from full length -> 0, never touching the attr.
    root.querySelectorAll<SVGGeometryElement>("[data-draw]").forEach((el, i) => {
      const len = Number(el.dataset.draw) || 0;
      anims.push(
        el.animate(
          [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: 900, delay: 150 + i * 130, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    // Forecast cone/tail — projection, not history: fade in rather than draw in.
    root.querySelectorAll<SVGElement>("[data-fade]").forEach((el, i) => {
      anims.push(
        el.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 500, delay: 650 + i * 90, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    // Last-point callout — pops in once the line has drawn.
    root.querySelectorAll<SVGElement>("[data-pop]").forEach((el, i) => {
      anims.push(
        el.animate(
          [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
          { duration: 420, delay: 950 + i * 60, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    // Readiness bars — same scaleX(0)->scaleX(1) convention as League's chase bar.
    root.querySelectorAll<HTMLElement>("[data-grow]").forEach((el, i) => {
      el.style.transformOrigin = "left center";
      anims.push(
        el.animate(
          [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          { duration: 700, delay: 250 + i * 90, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    root.querySelectorAll<HTMLElement>("[data-row]").forEach((el, i) => {
      anims.push(
        el.animate(
          [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
          { duration: 420, delay: 300 + i * 70, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    return () => anims.forEach((a) => a.cancel());
  }, []);

  return null;
}
