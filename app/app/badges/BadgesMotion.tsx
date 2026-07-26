"use client";

/**
 * Badges screen motion + tooltips (client island over server-rendered markup).
 * Everything it animates is already at its final state in the DOM (rings drawn,
 * rails filled, counts printed, heatmap coloured) — so SSR / no-JS / reduced
 * motion show the real data immediately. This only layers WAAPI entrance motion
 * and wires the hover/focus tooltip. Operates on [data-badges-root] via data
 * attributes; renders a single fixed tooltip node.
 */

import { useEffect, useRef } from "react";

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

export function BadgesMotion() {
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-badges-root]");
    if (!root) return;
    const anims: Animation[] = [];

    // Полную entrance-хореографию играем один раз за сессию: всё уже в финальном
    // состоянии (server-render), так что на повторных заходах показываем сразу,
    // не заставляя возвращающегося пользователя ждать ~1.3 с каждый раз.
    let firstPlay = true;
    try {
      firstPlay = !sessionStorage.getItem("bdg-motion-played");
      if (firstPlay) sessionStorage.setItem("bdg-motion-played", "1");
    } catch {
      // private mode / storage недоступен — деградируем к «играть как раньше».
      firstPlay = true;
    }

    if (!prefersReduced() && firstPlay) {
      root.querySelectorAll<HTMLElement>("[data-countup]").forEach((el) =>
        countUp(el, Number(el.dataset.countup) || 0, 850),
      );
      root.querySelectorAll<SVGCircleElement>("[data-arc]").forEach((arc) => {
        const c = Number(arc.dataset.c);
        const off = Number(arc.dataset.off);
        anims.push(
          arc.animate(
            [{ strokeDashoffset: c }, { strokeDashoffset: off }],
            { duration: 1000, easing: EASE_OUT, fill: "backwards" },
          ),
        );
      });
      root.querySelectorAll<HTMLElement>("[data-grow]").forEach((el, i) => {
        el.style.transformOrigin = "left center";
        anims.push(
          el.animate(
            [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
            { duration: 900, delay: 200 + i * 110, easing: EASE_OUT, fill: "backwards" },
          ),
        );
      });
      root.querySelectorAll<HTMLElement>("[data-pop]").forEach((el, i) => {
        anims.push(
          el.animate(
            [{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
            { duration: 500, delay: 260 + i * 60, easing: EASE_OUT, fill: "backwards" },
          ),
        );
      });
      root.querySelectorAll<HTMLElement>("[data-heat]").forEach((el) => {
        const i = Number(el.dataset.heat);
        anims.push(
          el.animate(
            [{ transform: "scale(.5)", opacity: 0.35 }, { transform: "scale(1)", opacity: 1 }],
            { duration: 380, delay: 320 + i * 13, easing: EASE_OUT, fill: "backwards" },
          ),
        );
      });
    }

    // Tooltip — hover AND keyboard focus; positioned fixed so cards never clip it.
    const tip = tipRef.current;
    if (!tip) return () => anims.forEach((a) => a.cancel());
    let described: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      if (!el.dataset.tip) return;
      tip.textContent = el.dataset.tip;
      // Связь для скринридера: фокус на узле → tooltip озвучивается как описание.
      if (described && described !== el) described.removeAttribute("aria-describedby");
      described = el;
      el.setAttribute("aria-describedby", "bdg-tip");
      tip.classList.add("show");
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
      let y = r.top - t.height - 9;
      let below = false;
      if (y < 8) {
        y = r.bottom + 9;
        below = true;
      }
      tip.classList.toggle("below", below);
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    const hide = () => {
      tip.classList.remove("show");
      if (described) {
        described.removeAttribute("aria-describedby");
        described = null;
      }
    };
    const over = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (t) show(t);
    };
    const out = (e: Event) => {
      if ((e.target as HTMLElement).closest("[data-tip]")) hide();
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", out);
    root.addEventListener("focusin", over);
    root.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);

    return () => {
      anims.forEach((a) => a.cancel());
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", out);
      root.removeEventListener("focusin", over);
      root.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  return <div ref={tipRef} id="bdg-tip" className="bdg-tip" role="tooltip" />;
}
