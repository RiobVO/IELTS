/**
 * E2e-preload (грузится раннером run-stateful-e2e.ts через NODE_OPTIONS
 * --import во всю цепочку процессов, включая dev-сервер). Два независимых патча
 * глобального undici-диспетчера:
 *
 * 1) Keep-alive resilience. Локальный dev-сервер ходит к ДАЛЁКОМУ Free-стенду
 *    Supabase (eu-central); idle keep-alive сокеты global fetch (undici —
 *    supabase-js Auth в login-экшене, getUser в middleware, PostgREST-чтения)
 *    молча рвутся сетевым путём, а undici переиспользует полумёртвый сокет →
 *    read ECONNRESET → TypeError: fetch failed (падает логин).
 *    Фикс: ТОЛЬКО короткое keep-alive окно (сокет простоял >1с → закрываем сами,
 *    следующий запрос берёт свежее соединение, а не дохлое). RetryAgent здесь
 *    стоял и был убран сознательно: он повторял POST с уже прочитанным телом
 *    (RequestContentLengthMismatchError) и ретраил 429 почтовой квоты, превращая
 *    оба в непрозрачный «fetch failed» — маскировка реальных статусов хуже, чем
 *    редкий честный сетевой сбой.
 *
 * 2) Жёсткая блокировка Writing/Speaking eval-триггера (волна 3b). Раннер
 *    (run-stateful-e2e.ts) больше НЕ подменяет NEXT_PUBLIC_SITE_URL на discard-порт
 *    вроде 127.0.0.1:9 — та подмена ломала signup-редирект (общий origin приложения,
 *    внешнее ревью) и полагалась на то, что мёртвый порт никто не слушает. Origin
 *    теперь указывает на baseURL этого же e2e-прогона (http://localhost:3000) —
 *    валидный для signup, но серверный triggerEvaluate-fetch (src/lib/writing/store.ts,
 *    src/lib/speaking/store.ts) при НЕзаблокированном диспетчере реально дошёл бы
 *    до /api/{writing,speaking}/evaluate этого же dev-сервера и исполнил бы роут. Этот
 *    интерцептор матчит запрос ПО ПУТИ (без привязки к origin — сработает что на
 *    localhost, что на прод-origin, если он когда-то вернётся; только наш же серверный
 *    триггер вообще ходит на этот путь, реальные страницы Playwright его не дёргают) и
 *    обрывает его синхронно, до какого-либо DNS/сокета: submission гарантированно
 *    остаётся pending, а не «может повезёт не достучаться». Фейковые
 *    GEMINI_API_KEY/модели/internal-секреты в раннере — второй, уже избыточный барьер
 *    (роут даже не исполнится).
 *
 * Only e2e: в проде Vercel↔Supabase в одном регионе, инстансы короткоживущие —
 * этой сетевой флакости нет, а eval-триггер обязан реально долетать. Прод-код
 * (src/) не трогаем.
 */
import { setGlobalDispatcher, Agent } from "undici";

const EVALUATE_PATH_RE = /^\/api\/(writing|speaking)\/evaluate(?:\?|$)/;

/** Синхронно обрывает запросы на /api/{writing,speaking}/evaluate — см. п.2 в шапке файла. */
function blockEvaluateInterceptor(dispatch) {
  return function interceptedDispatch(opts, handler) {
    const path = typeof opts.path === "string" ? opts.path : "";
    if (!EVALUATE_PATH_RE.test(path)) return dispatch(opts, handler);

    const origin = typeof opts.origin === "string" ? opts.origin : "";
    process.stderr.write(`[e2e-undici-resilience] BLOCKED outbound evaluate call: ${origin}${path}\n`);
    handler.onError?.(new Error("E2E: evaluate call blocked by design"));
    return true;
  };
}

setGlobalDispatcher(
  new Agent({
    pipelining: 0,
    keepAliveTimeout: 1000,
    keepAliveMaxTimeout: 1000,
    connect: { timeout: 10_000 },
  }).compose(blockEvaluateInterceptor),
);

// ВАЖНО: только stderr. Этот preload грузится в КАЖДЫЙ node в цепочке
// (npm run dev → npm-prefix.js и т.п.); печать в stdout ломает npm-парсинг
// stdout дочернего процесса (ERR_MODULE_NOT_FOUND на нашей же строке лога).
process.stderr.write("[e2e-undici-resilience] global fetch dispatcher patched (keep-alive + evaluate block)\n");
