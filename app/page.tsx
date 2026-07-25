"use client";

import { useEffect } from "react";
import "./landing.css";

export default function Home() {
  useEffect(() => {
    // ── shared reduced-motion flag ──────────────────────────────────────────
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── band-selector data ──────────────────────────────────────────────────
    const BANDS: Record<string, { band: string; rows: [string, number, number][] }> = {
      "5.5": { band: "5.5", rows: [["Sentence Completion", 3, 9], ["Matching Headings", 2, 6], ["Multiple Choice", 4, 9], ["True / False / Not Given", 6, 9]] },
      "6.0": { band: "6.0", rows: [["Matching Headings", 2, 6], ["Matching Information", 3, 8], ["Multiple Choice", 5, 9], ["True / False / Not Given", 6, 9]] },
      "6.5": { band: "6.5", rows: [["Matching Headings", 2, 6], ["True / False / Not Given", 5, 9], ["Multiple Choice", 6, 9], ["Matching Information", 6, 8]] },
      "7.0": { band: "7.0", rows: [["Yes / No / Not Given", 4, 7], ["Matching Headings", 4, 6], ["Multiple Choice", 7, 9], ["Sentence Completion", 7, 8]] },
    };

    const rowsEl = document.getElementById("rows");
    const bandNum = document.getElementById("bandNum");
    const bresEl = document.getElementById("bres");
    const targLab = document.getElementById("targLab");
    const tfill = document.getElementById("tfill");

    function colFor(p: number) {
      return p < 45 ? "var(--red)" : p < 70 ? "var(--amber)" : "var(--green)";
    }

    // scramble / decode text effect
    const SC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ/—";
    function scrambleTo(el: HTMLElement, text: string) {
      if (reduce) { el.textContent = text; return; }
      const old = el.textContent || "";
      const len = Math.max(old.length, text.length);
      let frame = 0;
      const q: { f: string; t: string; s: number; e: number; c: string }[] = [];
      for (let i = 0; i < len; i++) {
        const s = Math.floor(Math.random() * 10);
        q.push({ f: old[i] || "", t: text[i] || "", s, e: s + 8 + Math.floor(Math.random() * 12), c: "" });
      }
      const elAny = el as HTMLElement & { _r?: number };
      cancelAnimationFrame(elAny._r ?? 0);
      (function up() {
        let out = "";
        let done = 0;
        for (let i = 0; i < q.length; i++) {
          const x = q[i];
          if (frame >= x.e) { done++; out += x.t; }
          else if (frame >= x.s) {
            if (x.t === " ") { out += " "; }
            else { if (!x.c || Math.random() < 0.3) x.c = SC[Math.floor(Math.random() * SC.length)]; out += '<span class="dim">' + x.c + "</span>"; }
          } else { out += x.f; }
        }
        el.innerHTML = out;
        if (done < q.length) { frame++; elAny._r = requestAnimationFrame(up); }
      })();
    }

    function setCycle(rows: [string, number, number][]) {
      if (bresEl) bresEl.textContent = rows[0][0];
    }

    const cardEl = document.getElementById("card");

    function animateNum(el: HTMLElement, from: number, to: number) {
      if (reduce) { el.textContent = to.toFixed(1); return; }
      let t0: number | null = null;
      (function s(ts: number) {
        if (!t0) t0 = ts;
        const p = Math.min((ts - t0) / 450, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = (from + (to - from) * e).toFixed(1);
        if (p < 1) requestAnimationFrame(s);
      })(performance.now());
    }

    let prevBand = 6.5;

    function render(key: string, animate: boolean, isSwitch?: boolean) {
      const d = BANDS[key];
      const to = parseFloat(d.band);
      const rows = d.rows.slice().sort((a, b) => a[1] / a[2] - b[1] / b[2]) as [string, number, number][];
      if (rowsEl) {
        rowsEl.innerHTML = rows.map((r, i) => {
          const p = Math.round(r[1] / r[2] * 100);
          const c = colFor(p);
          const w = i === 0 ? ' <span class="weakt">weakest</span>' : "";
          return '<div class="bar"><div class="bar-h"><span class="bar-n">' + r[0] + w + '</span><span class="bar-s" style="color:' + c + '">' + r[1] + "/" + r[2] + '</span></div><div class="track"><div class="fill" style="background:' + c + '" data-w="' + p + '%"></div></div></div>';
        }).join("");
      }
      setCycle(rows);
      const gap = Math.max(0, Math.round((7 - to) * 10) / 10);
      if (targLab) targLab.textContent = gap <= 0 ? "7.0 target reached" : gap.toFixed(1) + " bands to your 7.0 target";
      if (tfill) (tfill as HTMLElement).style.width = Math.min(to / 7 * 100, 100) + "%";
      if (isSwitch && !reduce && bandNum && cardEl) {
        scrambleTo(bandNum, d.band);
        bandNum.classList.remove("pop"); void bandNum.offsetWidth; bandNum.classList.add("pop");
        cardEl.classList.remove("flash"); void cardEl.offsetWidth; cardEl.classList.add("flash");
        setTimeout(() => { cardEl.classList.remove("flash"); }, 540);
      } else if (bandNum) {
        bandNum.textContent = d.band;
      }
      prevBand = to;
      if (!rowsEl) return;
      const bars = rowsEl.querySelectorAll<HTMLElement>(".bar");
      const fills = rowsEl.querySelectorAll<HTMLElement>(".fill");
      if (reduce || !animate) { fills.forEach(f => { f.style.width = f.dataset.w ?? "0%"; }); return; }
      bars.forEach((b, i) => {
        b.style.opacity = "0"; b.style.transform = "translateY(12px)";
        setTimeout(() => {
          b.style.transition = "opacity .5s var(--ease),transform .5s var(--ease)";
          b.style.opacity = "1"; b.style.transform = "none";
        }, 40 + i * 85);
      });
      requestAnimationFrame(() => { fills.forEach((f, i) => { setTimeout(() => { f.style.width = f.dataset.w ?? "0%"; }, 150 + i * 100); }); });
    }

    render("6.5", false);

    // Card intersection — animate bars once when visible
    let cardSeen = false;
    let cardObserver: IntersectionObserver | null = null;
    const cardNode = document.getElementById("card");
    if ("IntersectionObserver" in window && !reduce && cardNode) {
      cardObserver = new IntersectionObserver((es) => {
        es.forEach(e => {
          if (e.isIntersecting && !cardSeen) {
            cardSeen = true;
            render("6.5", true);
            cardObserver?.disconnect();
          }
        });
      }, { threshold: 0.4 });
      cardObserver.observe(cardNode);
    } else {
      render("6.5", false);
    }

    // Band-selector pills
    document.querySelectorAll<HTMLButtonElement>(".bp").forEach(p => {
      p.addEventListener("click", () => {
        document.querySelectorAll<HTMLButtonElement>(".bp").forEach(x => x.classList.remove("on"));
        p.classList.add("on");
        render(p.dataset.b ?? "6.5", true, true);
      });
    });

    // Scroll progress bar — rAF-batched, GPU-composited via transform:scaleX
    // (animating width would layout+paint the fixed bar every scroll tick).
    const prog = document.getElementById("prog");
    let progTicking = false;
    function paintProgress() {
      progTicking = false;
      if (!prog) return;
      const h = document.documentElement;
      const ratio = h.scrollHeight - h.clientHeight > 0 ? h.scrollTop / (h.scrollHeight - h.clientHeight) : 0;
      prog.style.transform = `scaleX(${ratio})`;
    }
    function onScroll() {
      if (progTicking) return;
      progTicking = true;
      requestAnimationFrame(paintProgress);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    paintProgress();

    // Scroll reveals
    let revealObserver: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window && !reduce) {
      revealObserver = new IntersectionObserver((es) => {
        es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); revealObserver?.unobserve(e.target); } });
      }, { threshold: 0.14 });
      document.querySelectorAll(".rv").forEach(el => revealObserver!.observe(el));
    } else {
      document.querySelectorAll(".rv").forEach(el => el.classList.add("in"));
    }

    // Count-up
    function countUp(el: HTMLElement) {
      const t = parseFloat(el.dataset.count ?? "0");
      const dec = parseInt(el.dataset.dec ?? "0");
      const pre = el.dataset.pre ?? "";
      const suf = el.dataset.suf ?? "";
      let t0: number | null = null;
      function step(ts: number) {
        if (!t0) t0 = ts;
        const pr = Math.min((ts - t0) / 1500, 1);
        const e = 1 - Math.pow(1 - pr, 3);
        const v = t * e;
        el.textContent = pre + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suf;
        if (pr < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    let countObserver: IntersectionObserver | null = null;
    if (reduce) {
      document.querySelectorAll<HTMLElement>("[data-count]").forEach(el => {
        const d = parseInt(el.dataset.dec ?? "0");
        el.textContent = (el.dataset.pre ?? "") + (d ? parseFloat(el.dataset.count ?? "0").toFixed(d) : parseInt(el.dataset.count ?? "0").toLocaleString()) + (el.dataset.suf ?? "");
      });
    } else {
      countObserver = new IntersectionObserver((es) => {
        es.forEach(e => { if (e.isIntersecting) { countUp(e.target as HTMLElement); countObserver?.unobserve(e.target); } });
      }, { threshold: 0.6 });
      document.querySelectorAll<HTMLElement>("[data-count]").forEach(el => countObserver!.observe(el));
    }

    // 3D tilt + magnetic CTA (pointer: fine only)
    let tiltRaf: number | undefined;
    let tiltCardEl: HTMLElement | null = null;
    let tiltCtaEl: HTMLElement | null = null;
    function onCardMouseMove(e: MouseEvent) {
      if (!tiltCardEl) return;
      const r = tiltCardEl.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(tiltRaf ?? 0);
      tiltRaf = requestAnimationFrame(() => {
        if (tiltCardEl) tiltCardEl.style.transform = "rotateY(" + (x * 6) + "deg) rotateX(" + (-y * 6) + "deg) translateY(-2px)";
      });
    }
    function onCardMouseLeave() { if (tiltCardEl) tiltCardEl.style.transform = ""; }
    function onCtaMouseMove(e: MouseEvent) {
      if (!tiltCtaEl) return;
      const r = tiltCtaEl.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tiltCtaEl.style.transform = "translate(" + (x * 8) + "px," + (y * 6 - 2) + "px)";
    }
    function onCtaMouseLeave() { if (tiltCtaEl) tiltCtaEl.style.transform = ""; }

    if (!reduce && matchMedia("(pointer:fine)").matches) {
      tiltCardEl = document.getElementById("card");
      tiltCtaEl = document.getElementById("cta");
      if (tiltCardEl) {
        tiltCardEl.addEventListener("mousemove", onCardMouseMove);
        tiltCardEl.addEventListener("mouseleave", onCardMouseLeave);
      }
      if (tiltCtaEl) {
        tiltCtaEl.addEventListener("mousemove", onCtaMouseMove);
        tiltCtaEl.addEventListener("mouseleave", onCtaMouseLeave);
      }
    }

    // .hx scramble on hover
    document.querySelectorAll<HTMLElement>(".hx").forEach(el => {
      el.addEventListener("mouseenter", () => { el.classList.add("dec"); scrambleTo(el, el.dataset.text ?? ""); });
      el.addEventListener("mouseleave", () => { el.classList.remove("dec"); el.textContent = el.dataset.text ?? ""; });
    });

    // ── Hero canvas animation ───────────────────────────────────────────────
    let heroAnimId: number | undefined;
    (function () {
      const cvRaw = document.getElementById("heroCanvas") as HTMLCanvasElement | null;
      if (!cvRaw || reduce) return;
      const cv: HTMLCanvasElement = cvRaw;
      const hero = cv.parentElement!;
      const ctx = cv.getContext("2d")!;
      let W = 0, H = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      interface Particle { x: number; y: number; ox: number; oy: number; vx: number; vy: number; s: number; v: boolean; }
      interface BgParticle { x: number; y: number; vx: number; vy: number; s: number; a: number; ph: number; }
      let parts: Particle[] = [], bg: BgParticle[] = [];
      const mouse = { x: -9999, y: -9999, on: false };
      const DENS = 0.00009, BGDENS = 0.00004, R = 160, RET = 0.07, DAMP = 0.9, REP = 1.1;
      function rnd(a: number, b: number) { return Math.random() * (b - a) + a; }
      function init() {
        const n = Math.floor(W * H * DENS); parts = [];
        for (let i = 0; i < n; i++) { const x = Math.random() * W, y = Math.random() * H; parts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, s: rnd(1, 2.6), v: Math.random() > 0.9 }); }
        const m = Math.floor(W * H * BGDENS); bg = [];
        for (let j = 0; j < m; j++) { bg.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, s: rnd(0.6, 1.5), a: rnd(0.08, 0.22), ph: Math.random() * 6.28 }); }
      }
      function resize() {
        const r = hero.getBoundingClientRect();
        W = r.width; H = r.height;
        cv.width = W * dpr; cv.height = H * dpr;
        cv.style.width = W + "px"; cv.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        init();
      }
      function frame(t: number) {
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < bg.length; i++) {
          const p = bg[i]; p.x += p.vx; p.y += p.vy;
          if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
          const tw = Math.sin(t * 0.002 + p.ph) * 0.5 + 0.5;
          ctx.globalAlpha = p.a * (0.3 + 0.7 * tw); ctx.fillStyle = "#8170EA";
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
        for (let k = 0; k < parts.length; k++) {
          const q = parts[k];
          const dx = mouse.x - q.x, dy = mouse.y - q.y, d = Math.sqrt(dx * dx + dy * dy);
          if (mouse.on && d < R && d > 0) { const f = (R - d) / R * REP; q.vx -= (dx / d) * f * 5; q.vy -= (dy / d) * f * 5; }
          q.vx += (q.ox - q.x) * RET; q.vy += (q.oy - q.y) * RET; q.vx *= DAMP; q.vy *= DAMP; q.x += q.vx; q.y += q.vy;
          const sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy);
          ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 6.283);
          ctx.fillStyle = q.v ? "rgba(129,112,234," + Math.min(0.22 + sp * 0.1, 0.6) + ")" : "rgba(25,21,41," + Math.min(0.1 + sp * 0.07, 0.4) + ")";
          ctx.fill();
        }
        heroAnimId = requestAnimationFrame(frame);
      }
      function onHeroMouseMove(e: MouseEvent) { const r = hero.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = true; }
      function onHeroMouseLeave() { mouse.on = false; mouse.x = -9999; mouse.y = -9999; }
      hero.addEventListener("mousemove", onHeroMouseMove);
      hero.addEventListener("mouseleave", onHeroMouseLeave);
      window.addEventListener("resize", resize);
      resize();
      heroAnimId = requestAnimationFrame(frame);
    })();

    // ── Question-type filter ────────────────────────────────────────────────
    (function () {
      const btns = document.querySelectorAll<HTMLButtonElement>(".tf");
      if (!btns.length) return;
      const items = document.querySelectorAll<HTMLElement>("#typeList .ti");
      btns.forEach(b => {
        b.addEventListener("click", () => {
          btns.forEach(x => x.classList.remove("on")); b.classList.add("on");
          const f = b.dataset.f ?? "all";
          let vis = 0;
          items.forEach(t => {
            const c = t.dataset.cat;
            let show: boolean;
            if (f === "all") show = true;
            else if (f === "hot") show = t.dataset.hot === "1";
            else show = (c === f) || (c === "both");
            t.style.display = show ? "" : "none";
            // Каскадное появление видимых строк по индексу видимости; при
            // reduced-motion — без анимации (только show/hide).
            if (show && !reduce) {
              t.style.setProperty("--i", String(vis++));
              t.style.animation = "none";        // сброс…
              void t.offsetWidth;                // …reflow ретриггерит rise
              t.style.animation = "rise .35s ease both";
              t.style.animationDelay = "calc(var(--i) * 40ms)";
            }
          });
        });
      });
    })();

    // ── Final-section canvas (finalCanvas not in markup — gracefully no-ops) ──
    let finalAnimId: number | undefined;
    (function () {
      const cvRaw = document.getElementById("finalCanvas") as HTMLCanvasElement | null;
      if (!cvRaw || reduce) return;
      const cv: HTMLCanvasElement = cvRaw;
      const box = cv.parentElement!;
      const ctx = cv.getContext("2d")!;
      let W = 0, H = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      interface Particle { x: number; y: number; ox: number; oy: number; vx: number; vy: number; s: number; v: boolean; }
      interface BgParticle { x: number; y: number; vx: number; vy: number; s: number; a: number; ph: number; }
      let parts: Particle[] = [], bg: BgParticle[] = [];
      const mouse = { x: -9999, y: -9999, on: false };
      const DENS = 0.00008, BGDENS = 0.00004, R = 150, RET = 0.07, DAMP = 0.9, REP = 1.1;
      function rnd(a: number, b: number) { return Math.random() * (b - a) + a; }
      function init() {
        const n = Math.floor(W * H * DENS); parts = [];
        for (let i = 0; i < n; i++) { const x = Math.random() * W, y = Math.random() * H; parts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, s: rnd(1, 2.4), v: Math.random() > 0.8 }); }
        const m = Math.floor(W * H * BGDENS); bg = [];
        for (let j = 0; j < m; j++) { bg.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.16, s: rnd(0.6, 1.4), a: rnd(0.1, 0.3), ph: Math.random() * 6.28 }); }
      }
      function resize() {
        const r = box.getBoundingClientRect();
        W = r.width; H = r.height;
        cv.width = W * dpr; cv.height = H * dpr;
        cv.style.width = W + "px"; cv.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        init();
      }
      function frame(t: number) {
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < bg.length; i++) {
          const p = bg[i]; p.x += p.vx; p.y += p.vy;
          if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
          const tw = Math.sin(t * 0.002 + p.ph) * 0.5 + 0.5;
          ctx.globalAlpha = p.a * (0.3 + 0.7 * tw); ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
        for (let k = 0; k < parts.length; k++) {
          const q = parts[k];
          const dx = mouse.x - q.x, dy = mouse.y - q.y, d = Math.sqrt(dx * dx + dy * dy);
          if (mouse.on && d < R && d > 0) { const f = (R - d) / R * REP; q.vx -= (dx / d) * f * 5; q.vy -= (dy / d) * f * 5; }
          q.vx += (q.ox - q.x) * RET; q.vy += (q.oy - q.y) * RET; q.vx *= DAMP; q.vy *= DAMP; q.x += q.vx; q.y += q.vy;
          const sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy);
          ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, 6.283);
          ctx.fillStyle = q.v ? "rgba(255,255,255," + Math.min(0.55 + sp * 0.12, 1) + ")" : "rgba(255,255,255," + Math.min(0.2 + sp * 0.08, 0.6) + ")";
          ctx.fill();
        }
        finalAnimId = requestAnimationFrame(frame);
      }
      function onBoxMouseMove(e: MouseEvent) { const r = box.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = true; }
      function onBoxMouseLeave() { mouse.on = false; mouse.x = -9999; mouse.y = -9999; }
      box.addEventListener("mousemove", onBoxMouseMove);
      box.addEventListener("mouseleave", onBoxMouseLeave);
      window.addEventListener("resize", resize);
      resize();
      finalAnimId = requestAnimationFrame(frame);
    })();

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (heroAnimId !== undefined) cancelAnimationFrame(heroAnimId);
      if (finalAnimId !== undefined) cancelAnimationFrame(finalAnimId);
      if (tiltRaf !== undefined) cancelAnimationFrame(tiltRaf);
      cardObserver?.disconnect();
      revealObserver?.disconnect();
      countObserver?.disconnect();
      if (tiltCardEl) {
        tiltCardEl.removeEventListener("mousemove", onCardMouseMove);
        tiltCardEl.removeEventListener("mouseleave", onCardMouseLeave);
      }
      if (tiltCtaEl) {
        tiltCtaEl.removeEventListener("mousemove", onCtaMouseMove);
        tiltCtaEl.removeEventListener("mouseleave", onCtaMouseLeave);
      }
    };
  }, []);

  return (
    <>
      <div className="progress" id="prog"></div>

      <nav>
        <div className="wrap nav-in">
          <a className="logo" href="/">
            <span className="seal"><i></i><i></i><i></i></span>band<span className="o">o</span>
          </a>
          <div className="nav-links">
            <a href="/app/reading">Reading</a>
            <a href="/app/listening">Listening</a>
            <a href="#how">How it works</a>
            <a href="/pricing">Pricing</a>
          </div>
          <div className="nav-r">
            <a href="/auth" style={{ color: "var(--ink-2)" }}>Log in</a>
            <a href="/auth" className="btn btn-v">Start free</a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <canvas className="hero-canvas" id="heroCanvas" aria-hidden="true"></canvas>
        <div className="wrap hero-grid">
          <div>
            <span className="pill" style={{ animation: "rise .8s var(--ease) forwards", opacity: 0 }}>
              <svg className="ico" viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c0 1 2.5 2.5 5 2.5s5-1.5 5-2.5v-5"/></svg>
              IELTS Reading &amp; Listening
            </span>
            <h1>
              <span className="hl" style={{ animationDelay: ".08s" }}>Stop</span>{" "}
              <span className="hl" style={{ animationDelay: ".16s" }}>guessing</span>
              <br />
              <span className="hl" style={{ animationDelay: ".24s" }}>your</span>{" "}
              <span className="hl" style={{ animationDelay: ".3s" }}><em>band.</em></span>
            </h1>
            <p className="lede">
              The real exam tells you <span className="hx" data-text="6.5">6.5</span> and walks away. bando shows the exact question types <b>costing you points</b> — then drills them.
            </p>
            <div className="bandsel">
              <span className="bl">Stuck at</span>
              <div className="bpills" id="bpills">
                <button type="button" className="bp" data-b="5.5">5.5</button>
                <button type="button" className="bp" data-b="6.0">6.0</button>
                <button type="button" className="bp on" data-b="6.5">6.5</button>
                <button type="button" className="bp" data-b="7.0">7.0</button>
              </div>
              <span className="bres">{"It's usually "}<b id="bres">Matching Headings</b>{" quietly costing you the band."}</span>
            </div>
            <div className="cta-row">
              <a href="/auth" className="btn btn-v btn-lg" id="cta">
                Take a free test
                <svg className="ico" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </a>
              <a href="#how" className="btn btn-g btn-lg">
                <svg className="ico" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
                Watch 60-sec demo
              </a>
            </div>
            <div className="micro"><b>Free</b> full mock · no card · <b>20 min</b> to your weakest type</div>
          </div>

          <div className="scene">
            <div className="card" id="card">
              <div className="card-top">
                <div className="bscore"><div className="k">Band score</div><div className="v" id="bandNum">6.5</div></div>
                <span className="ptag"><span className="dot"></span>per-type analytics</span>
              </div>
              <div className="targ">
                <span className="tlab" id="targLab">0.5 bands to your 7.0 target</span>
                <div className="tbar"><i id="tfill"></i></div>
              </div>
              <div className="wlp">Where you lose points</div>
              <div id="rows"></div>
              <div className="card-foot">
                <span>Tap any type to drill it</span>
                <span className="go">Practise weakest <svg className="ico" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="pad" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h cn rv" style={{ marginBottom: "48px" }}>
            <span className="ek">The bando difference</span>
            <h2>More tests won&apos;t fix it. <em>Knowing your type will.</em></h2>
            <p>You don&apos;t have a stamina problem — you have a blind spot, and we name it.</p>
          </div>
          <div className="vs">
            <div className="vc them rv">
              <div className="vh">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9"/></svg>
                Every other app
              </div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>Hands you a band score</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>A pile of tests — &ldquo;practice more&rdquo;</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>No idea which type is wrong</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>You burn weeks guessing</div>
            </div>
            <div className="vc us rv">
              <div className="vh"><span className="bd">bando</span>Shows you the reason</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Score broken down by question type</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Your weakest type, flagged in red</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>One tap to drill only that</div>
              <div className="vr"><svg className="m ico" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>You fix the exact thing — and move</div>
            </div>
          </div>
        </div>
      </section>

      <section className="pad" id="types" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h rv" style={{ marginBottom: "10px" }}>
            <span className="ek">No guesswork</span>
            <h2>14 question types. We tell you which one is yours.</h2>
            <p>In red — where students quietly lose the half-band that costs them everything.</p>
          </div>
          <div className="tfilter rv">
            <button type="button" className="tf on" data-f="all">All <span>14</span></button>
            <button type="button" className="tf" data-f="reading">Reading</button>
            <button type="button" className="tf" data-f="listening">Listening</button>
            <button type="button" className="tf" data-f="hot">Hardest <span>4</span></button>
          </div>
          <div className="types rv" id="typeList">
            <div className="ti hot" data-cat="reading" data-hot="1"><span className="tn">01</span><span className="tt">Matching Headings</span><span className="tx">band-killer</span></div>
            <div className="ti" data-cat="reading"><span className="tn">02</span><span className="tt">True / False / Not Given</span><span className="tx">Reading</span></div>
            <div className="ti hot" data-cat="reading" data-hot="1"><span className="tn">03</span><span className="tt">Yes / No / Not Given</span><span className="tx">tricky</span></div>
            <div className="ti" data-cat="reading"><span className="tn">04</span><span className="tt">Multiple Choice</span><span className="tx">Reading</span></div>
            <div className="ti" data-cat="reading"><span className="tn">05</span><span className="tt">Matching Information</span><span className="tx">Reading</span></div>
            <div className="ti" data-cat="reading"><span className="tn">06</span><span className="tt">Matching Features</span><span className="tx">Reading</span></div>
            <div className="ti hot" data-cat="reading" data-hot="1"><span className="tn">07</span><span className="tt">Matching Sentence Endings</span><span className="tx">tricky</span></div>
            <div className="ti" data-cat="both"><span className="tn">08</span><span className="tt">Sentence Completion</span><span className="tx">both</span></div>
            <div className="ti" data-cat="both"><span className="tn">09</span><span className="tt">Summary / Note Completion</span><span className="tx">both</span></div>
            <div className="ti" data-cat="both"><span className="tn">10</span><span className="tt">Table / Flow-chart Completion</span><span className="tx">both</span></div>
            <div className="ti" data-cat="reading"><span className="tn">11</span><span className="tt">Diagram Label Completion</span><span className="tx">Reading</span></div>
            <div className="ti hot" data-cat="listening" data-hot="1"><span className="tn">12</span><span className="tt">Plan / Map / Diagram Labelling</span><span className="tx">band-killer</span></div>
            <div className="ti" data-cat="listening"><span className="tn">13</span><span className="tt">Form / Note Completion</span><span className="tx">Listening</span></div>
            <div className="ti" data-cat="both"><span className="tn">14</span><span className="tt">Short Answer</span><span className="tx">both</span></div>
          </div>
        </div>
      </section>

      <section className="pad" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h cn rv" style={{ marginBottom: "34px" }}>
            <span className="ek">Every question type</span>
            <h2>If it&apos;s on the test, it&apos;s in <em>bando</em>.</h2>
          </div>
        </div>
        <div className="tmarq rv">
          <div className="tmarq-row">
            <div className="tmarq-track" style={{ "--d": "58s" } as React.CSSProperties}>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Matching Headings</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>True / False / Not Given</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Multiple Choice</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Sentence Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Matching Information</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Short Answer</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Yes / No / Not Given</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Map / Diagram Labelling</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Matching Features</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Table Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Flow-chart Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Note Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Summary Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Diagram Labels</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Matching Sentence Endings</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Classification</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Pick from a list</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Multiple Choice (multi)</span>
              {/* duplicate set for seamless loop */}
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Matching Headings</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>True / False / Not Given</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Multiple Choice</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Sentence Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Matching Information</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Short Answer</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Yes / No / Not Given</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Map / Diagram Labelling</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Matching Features</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Table Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Flow-chart Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Note Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Summary Completion</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Diagram Labels</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--red)" }}></span>Matching Sentence Endings</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--green)" }}></span>Classification</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--v)" }}></span>Pick from a list</span>
              <span className="qpill"><span className="qd" style={{ background: "var(--amber)" }}></span>Multiple Choice (multi)</span>
            </div>
          </div>
          <div className="tmarq-row">
            <div className="tmarq-track rev" style={{ "--d": "64s" } as React.CSSProperties}>
              <span className="qpill ask">Why am I stuck at 6.5?</span>
              <span className="qpill ask">Where do I lose points?</span>
              <span className="qpill ask">Which type costs me marks?</span>
              <span className="qpill ask">How do I reach Band 7?</span>
              <span className="qpill ask">Is it Matching Headings again?</span>
              <span className="qpill ask">What should I drill next?</span>
              <span className="qpill ask">Why did I miss those 4 marks?</span>
              <span className="qpill ask">How do I stop guessing?</span>
              <span className="qpill ask">Am I ready for test day?</span>
              <span className="qpill ask">What&apos;s my weakest type?</span>
              <span className="qpill ask">Why do I run out of time?</span>
              <span className="qpill ask">How do I read faster?</span>
              <span className="qpill ask">Is my band going up?</span>
              <span className="qpill ask">What&apos;s costing me the visa?</span>
              <span className="qpill ask">Which type do I keep failing?</span>
              <span className="qpill ask">How close am I to my target?</span>
              {/* duplicate set for seamless loop */}
              <span className="qpill ask">Why am I stuck at 6.5?</span>
              <span className="qpill ask">Where do I lose points?</span>
              <span className="qpill ask">Which type costs me marks?</span>
              <span className="qpill ask">How do I reach Band 7?</span>
              <span className="qpill ask">Is it Matching Headings again?</span>
              <span className="qpill ask">What should I drill next?</span>
              <span className="qpill ask">Why did I miss those 4 marks?</span>
              <span className="qpill ask">How do I stop guessing?</span>
              <span className="qpill ask">Am I ready for test day?</span>
              <span className="qpill ask">What&apos;s my weakest type?</span>
              <span className="qpill ask">Why do I run out of time?</span>
              <span className="qpill ask">How do I read faster?</span>
              <span className="qpill ask">Is my band going up?</span>
              <span className="qpill ask">What&apos;s costing me the visa?</span>
              <span className="qpill ask">Which type do I keep failing?</span>
              <span className="qpill ask">How close am I to my target?</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pad" id="how" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-h cn rv" style={{ marginBottom: "44px" }}>
            <span className="ek">How bando works</span>
            <h2>Everything you need to <em>get your band</em>.</h2>
          </div>
          <div className="fgrid">
            <a className="fcard rv" href="/auth">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/emoji/stopwatch_3d.png" alt="Stopwatch" width={72} height={72} loading="lazy" decoding="async" />
              <div>
                <h3>Real exam mode</h3>
                <p>Computer-delivered IELTS — timer, navigator, mark-for-review, highlight &amp; notes. Reading on calm paper; single-pass Listening, exactly like exam day.</p>
                <span className="farr">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </span>
              </div>
            </a>
            <a className="fcard rv" href="/auth">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/emoji/bar_chart_3d.png" alt="Bar chart" width={72} height={72} loading="lazy" decoding="async" />
              <div>
                <h3>Per-type breakdown</h3>
                <p>Not just a 6.5 — every question type ranked worst-first, so the one weakness dragging your band down is impossible to miss.</p>
                <span className="farr">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </span>
              </div>
            </a>
            <a className="fcard rv" href="/auth">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/emoji/memo_3d.png" alt="Memo" width={72} height={72} loading="lazy" decoding="async" />
              <div>
                <h3>Targeted drills</h3>
                <p>Tap any weak type to practise only that — Matching Headings, TFNG, completion — until it stops costing you points.</p>
                <span className="farr">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </span>
              </div>
            </a>
            <a className="fcard rv" href="/auth">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/emoji/books_3d.png" alt="Books" width={72} height={72} loading="lazy" decoding="async" />
              <div>
                <h3>Full mock tests</h3>
                <p>Sit complete 40-question papers under real timing and get a projected band you can trust.</p>
                <span className="farr">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <div>
            <a className="logo" href="/">
              <span className="seal"><i></i><i></i><i></i></span>band<span className="o">o</span>
            </a>
            <p className="ft">The IELTS trainer that shows you where you lose points — then fixes them.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="/app/reading">Reading</a>
            <a href="/app/listening">Listening</a>
            <a href="/pricing">Pricing</a>
          </div>
          <div>
            <h4>Learn</h4>
            <a href="#how">How it works</a>
            <a href="/app/leaderboard">Leaderboard</a>
            <a href="/app/badges">Badges</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/about">About</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
        <div className="wrap copy">© 2026 bando · Stop guessing your band. · *Illustrative — pilot cohort.</div>
      </footer>
    </>
  );
}
