"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";

// Lead label per priority slot. The model returns fixes "most impactful first", so
// slot 0 carries the emphasis; extra slots (if ever >3) fall back to "Then".
const LEADS = ["Do this first · biggest impact", "Then", "And finally"];

const stepDelay = (i: number) => i * 1080; // card reveal, ms
const connDelay = (i: number) => 520 + (i - 1) * 1080; // arrow before step i (i>=1), ms

/**
 * Top fixes as a left→right guided path: each fix is a card, joined by a connector
 * whose comet arrow travels 1→2→3 once (on first view + replayable via re-entry),
 * lighting the trail brand as it passes. #1 is the accented hero. One-shot, never a
 * loop — a results screen shouldn't carry perpetual motion. Stacks to a column on
 * narrow viewports (arrows hidden); reduced-motion shows the final state, no movement.
 */
export function TopFixes({ fixes }: { fixes: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setPlay(true);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section>
      <style>{CSS}</style>
      <h2 style={S.h2}>Your top fixes</h2>
      <div ref={ref} className={`wf-tfpath${play ? " wf-tfplay" : ""}`}>
        {fixes.map((fix, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <div className="wf-tfconn" style={{ "--tc": connDelay(i) } as CSSProperties}>
                <span className="wf-tfdash" />
                <span className="wf-tffill" />
                <span className="wf-tfarrow">
                  <Arrow />
                </span>
              </div>
            )}
            <div className={`wf-tfstep${i === 0 ? " wf-first" : ""}`} style={{ "--t": stepDelay(i) } as CSSProperties}>
              <div className="wf-tfcard">
                <div className="wf-tfhead">
                  <span className="wf-tfdot">
                    {i + 1}
                    <span className="wf-tfring" />
                  </span>
                  <span className="wf-tflead">{LEADS[i] ?? "Then"}</span>
                </div>
                <p className="wf-tftxt">{fix}</p>
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true">
      <path d="M1 8h12M9 3l5 5-5 5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const S: Record<string, CSSProperties> = {
  h2: { margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" },
};

const CSS = `
.wf-tfpath{display:flex;align-items:stretch;gap:0}
.wf-tfstep{flex:1;min-width:0;display:flex}
.wf-tfcard{flex:1;display:flex;flex-direction:column;gap:9px;background:var(--surface);border:2px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-solid);padding:16px 17px}
.wf-tfstep.wf-first .wf-tfcard{border-color:var(--brand-border);background:color-mix(in oklab,var(--brand-subtle) 55%,#fff)}
.wf-tfhead{display:flex;align-items:center;gap:10px}
.wf-tfdot{position:relative;flex:none;width:32px;height:32px;border-radius:var(--radius-full);display:grid;place-items:center;font-family:var(--font-mono);font-weight:800;font-size:15px;background:var(--surface-inset);color:var(--text-secondary);border:2px solid var(--border-strong)}
.wf-tfstep.wf-first .wf-tfdot{background:var(--brand);color:var(--text-on-brand);border:none;box-shadow:0 3px 0 0 var(--violet-700)}
.wf-tfring{position:absolute;inset:-4px;border-radius:var(--radius-full);border:2px solid var(--brand);opacity:0}
.wf-tflead{font-family:var(--font-mono);font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted)}
.wf-tfstep.wf-first .wf-tflead{color:var(--brand)}
.wf-tftxt{margin:0;font-size:14px;line-height:1.5;font-weight:500;color:var(--text-primary);text-wrap:pretty}
.wf-tfstep.wf-first .wf-tftxt{font-weight:600}

.wf-tfconn{flex:none;width:48px;position:relative}
.wf-tfdash{position:absolute;top:50%;left:5px;right:5px;height:2px;transform:translateY(-50%);background:repeating-linear-gradient(90deg,var(--border-strong) 0 4px,transparent 4px 9px)}
.wf-tffill{position:absolute;top:50%;left:5px;right:5px;height:2px;transform:translateY(-50%) scaleX(0);transform-origin:left;background:linear-gradient(90deg,var(--brand),var(--brand-border));border-radius:2px}
.wf-tfarrow{position:absolute;top:50%;left:2px;transform:translateY(-50%);opacity:0;color:var(--brand);line-height:0}
.wf-tfarrow svg{display:block;margin-left:-8px;filter:drop-shadow(0 0 5px color-mix(in oklab,var(--brand) 55%,transparent))}

.wf-tfplay .wf-tfstep .wf-tfcard{opacity:0;transform:translateY(9px);animation:wf-tfRise .45s cubic-bezier(0.22,1,0.36,1) forwards;animation-delay:calc(var(--t) * 1ms)}
.wf-tfplay .wf-tfstep.wf-first .wf-tfdot{animation:wf-tfPop .5s cubic-bezier(0.16,1,0.3,1) backwards;animation-delay:calc((var(--t) + 120) * 1ms)}
.wf-tfplay .wf-tfstep:not(.wf-first) .wf-tfdot{animation:wf-tfActivate .5s cubic-bezier(0.16,1,0.3,1) backwards;animation-delay:calc((var(--t) + 120) * 1ms)}
.wf-tfplay .wf-tfring{animation:wf-tfRing .7s cubic-bezier(0.22,1,0.36,1) backwards;animation-delay:calc((var(--t) + 120) * 1ms)}
.wf-tfplay .wf-tffill{animation:wf-tfFill .55s cubic-bezier(0.22,1,0.36,1) forwards;animation-delay:calc(var(--tc) * 1ms)}
.wf-tfplay .wf-tfarrow{animation:wf-tfTravel .55s cubic-bezier(0.22,1,0.36,1) forwards;animation-delay:calc(var(--tc) * 1ms)}

@keyframes wf-tfRise{to{opacity:1;transform:none}}
@keyframes wf-tfPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes wf-tfActivate{0%{transform:scale(.4);opacity:0}60%{background:var(--brand);border-color:var(--brand);color:var(--text-on-brand)}to{transform:scale(1);opacity:1}}
@keyframes wf-tfRing{0%{opacity:.8;transform:scale(.7)}100%{opacity:0;transform:scale(1.5)}}
@keyframes wf-tfFill{from{transform:translateY(-50%) scaleX(0)}to{transform:translateY(-50%) scaleX(1)}}
@keyframes wf-tfTravel{0%{opacity:0;left:2px}14%{opacity:1}86%{opacity:1}100%{opacity:0;left:46px}}

@media (max-width:720px){
  .wf-tfpath{flex-direction:column;align-items:stretch}
  .wf-tfstep{width:100%}
  .wf-tfconn{display:none}
}
/* Lead-лейбл ("Do this first"/"Then"/"And finally") — смысловой текст, 12px. */
@media (max-width:430px){
  .wf-tflead{font-size:12px!important}
}
@media (prefers-reduced-motion:reduce){
  .wf-tfplay .wf-tfstep .wf-tfcard,.wf-tfplay .wf-tfdot,.wf-tfplay .wf-tfring,.wf-tfplay .wf-tffill,.wf-tfplay .wf-tfarrow{animation:none!important;opacity:1!important;transform:none!important}
  .wf-tffill{transform:translateY(-50%) scaleX(1)!important}
  .wf-tfdash{opacity:0}
  .wf-tfarrow{display:none}
}
`;
