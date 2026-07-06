"use client";

/**
 * League screen entrance motion (client island over server-rendered markup).
 * Everything is already at its final state in the DOM (podium heights, ranks,
 * chase bar) — so SSR / no-JS / reduced-motion show the real board immediately.
 * This only layers WAAPI entrance motion on [data-league-root] via data
 * attributes. Renders nothing.
 */

import { useEffect } from "react";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function countUp(el: HTMLElement, to: number, dur: number) {
  let start = 0;
  const step = (now: number) => {
    if (!start) start = now;
    const k = Math.min(1, (now - start) / dur);
    el.textContent = String(Math.round((1 - Math.pow(1 - k, 3)) * to));
    if (k < 1) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}

export function LeagueMotion() {
  useEffect(() => {
    if (prefersReduced()) return;
    const root = document.querySelector<HTMLElement>("[data-league-root]");
    if (!root) return;
    const anims: Animation[] = [];

    root.querySelectorAll<HTMLElement>("[data-countup]").forEach((el) =>
      countUp(el, Number(el.dataset.countup) || 0, 900),
    );
    root.querySelectorAll<HTMLElement>("[data-pedestal]").forEach((el, i) => {
      anims.push(
        el.animate(
          [{ height: "0px" }, { height: `${el.dataset.pedestal}px` }],
          { duration: 720, delay: 150 + i * 110, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });
    root.querySelectorAll<HTMLElement>("[data-fill]").forEach((el) => {
      el.style.transformOrigin = "left center";
      anims.push(
        el.animate(
          [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          { duration: 900, delay: 400, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });
    root.querySelectorAll<HTMLElement>("[data-row]").forEach((el, i) => {
      anims.push(
        el.animate(
          [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
          { duration: 460, delay: 300 + i * 55, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });

    return () => anims.forEach((a) => a.cancel());
  }, []);

  return null;
}
