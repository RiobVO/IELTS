// RUNTIME (read-time) bando re-skin для listening audio-gate (#playOverlay).
// Оригинальный HTML импортированного теста несёт ТЁМНЫЙ overlay (наушники / warn /
// прогресс / Play). Перекрываем его светлой bando-палитрой (violet brand, Jakarta,
// 3D-push Play со state'ами) инжектом <style> ПЕРЕД </head> — после оригинальных
// стилей файла, чтобы override выигрывал по порядку (+ #id-специфичность +
// !important как страховка). Делается на read-time в /runner route (рядом со
// scopeRunnerStorage), поэтому применяется ко ВСЕМ listening-тестам без переимпорта.
// Трогаем ТОЛЬКО селекторы gate (#playOverlay и его дети) — сам тест-раннер не наш,
// его интерфейс не переопределяем.

// Значения — прямо из app/tokens/colors.css (runner изолирован от наших токенов,
// поэтому встраиваем oklch литералами). Jakarta = шрифт bando UI (Google Fonts).
const GATE_SKIN = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap">
<style id="bando-gate-skin">
#playOverlay.play-ov{background:oklch(0.975 0.006 286)!important;color:oklch(0.245 0.014 280)!important;font-family:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif!important}
#playOverlay .hp{font-size:34px!important;width:76px!important;height:76px!important;display:grid!important;place-items:center!important;margin:0 auto!important;background:oklch(0.955 0.030 290)!important;border-radius:22px!important}
#playOverlay .warn{color:oklch(0.245 0.014 280)!important;font-weight:700!important;font-size:1.0625rem!important;line-height:1.55!important;max-width:48ch!important;margin:20px auto 0!important;text-wrap:balance}
#playOverlay .dl-wrap{max-width:440px!important;margin:26px auto 0!important}
#playOverlay .dl-bar{background:oklch(0.962 0.006 288)!important;height:10px!important;border-radius:999px!important;overflow:hidden!important}
#playOverlay .dl-fill,#playOverlay #dlBar{background:oklch(0.585 0.225 292)!important;border-radius:999px!important;transition:width .2s cubic-bezier(0.16,1,0.3,1)!important}
#playOverlay .dl-row{display:flex!important;justify-content:space-between!important;align-items:baseline!important;margin-top:10px!important;color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;font-weight:600!important}
#playOverlay #dlPct{font-family:ui-monospace,'JetBrains Mono','SFMono-Regular',monospace!important;font-weight:700!important;color:oklch(0.50 0.205 292)!important}
#playOverlay .cta{color:oklch(0.530 0.018 286)!important;font-size:.875rem!important;line-height:1.5!important;max-width:46ch!important;margin:22px auto 0!important;text-wrap:pretty}
#playOverlay .play-btn{background:oklch(0.585 0.225 292)!important;color:#fff!important;border:0!important;font-family:'Plus Jakarta Sans',system-ui,sans-serif!important;font-weight:800!important;font-size:1rem!important;letter-spacing:-0.01em!important;padding:13px 32px!important;border-radius:14px!important;margin-top:30px!important;box-shadow:0 3px 0 0 oklch(0.50 0.205 292)!important;cursor:pointer!important;transition:transform .15s cubic-bezier(0.16,1,0.3,1),box-shadow .15s,background .15s!important}
#playOverlay .play-btn:hover:not(:disabled){background:oklch(0.655 0.215 290)!important}
#playOverlay .play-btn:active:not(:disabled){transform:translateY(3px)!important;box-shadow:0 0 0 0 oklch(0.50 0.205 292)!important}
#playOverlay .play-btn:disabled{background:oklch(0.910 0.008 286)!important;color:oklch(0.740 0.014 288)!important;box-shadow:none!important;cursor:not-allowed!important}
#playOverlay .play-btn .tri{border-left-color:currentColor!important}
@media (prefers-reduced-motion:reduce){#playOverlay .dl-fill,#playOverlay #dlBar,#playOverlay .play-btn{transition:none!important}}
</style>`;

/**
 * Инжектит bando-skin gate'а перед `</head>` (после оригинальных стилей → выигрывает).
 * No-op, если в html нет `#playOverlay` (reading-раннер / тесты без аудио-гейта) или
 * нет `</head>`. Идемпотентно: повторный инжект исключён маркером `bando-gate-skin`.
 */
export function skinRunnerGate(html: string): string {
  if (html.includes("bando-gate-skin")) return html; // уже заскинено
  if (!/id=["']playOverlay["']/.test(html)) return html; // не listening-gate
  if (!/<\/head>/i.test(html)) return html; // нет безопасной точки — не трогаем
  return html.replace(/<\/head>/i, `${GATE_SKIN}</head>`);
}
