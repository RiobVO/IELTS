/**
 * E2e-preload (грузится раннером run-stateful-e2e.ts через NODE_OPTIONS
 * --import во всю цепочку процессов, включая dev-сервер). Проблема: локальный
 * dev-сервер ходит к ДАЛЁКОМУ Free-стенду Supabase (eu-central); idle
 * keep-alive сокеты global fetch (undici — supabase-js Auth в login-экшене,
 * getUser в middleware, PostgREST-чтения) молча рвутся сетевым путём, а undici
 * переиспользует полумёртвый сокет → read ECONNRESET → TypeError: fetch failed
 * (падает логин).
 *
 * Фикс: ТОЛЬКО короткое keep-alive окно (сокет простоял >1с → закрываем сами,
 * следующий запрос берёт свежее соединение, а не дохлое). RetryAgent здесь
 * стоял и был убран сознательно: он повторял POST с уже прочитанным телом
 * (RequestContentLengthMismatchError) и ретраил 429 почтовой квоты, превращая
 * оба в непрозрачный «fetch failed» — маскировка реальных статусов хуже, чем
 * редкий честный сетевой сбой.
 *
 * Only e2e: в проде Vercel↔Supabase в одном регионе, инстансы короткоживущие —
 * этой сетевой флакости нет. Прод-код (src/) не трогаем.
 */
import { setGlobalDispatcher, Agent } from "undici";

setGlobalDispatcher(
  new Agent({
    pipelining: 0,
    keepAliveTimeout: 1000,
    keepAliveMaxTimeout: 1000,
    connect: { timeout: 10_000 },
  }),
);

// ВАЖНО: только stderr. Этот preload грузится в КАЖДЫЙ node в цепочке
// (npm run dev → npm-prefix.js и т.п.); печать в stdout ломает npm-парсинг
// stdout дочернего процесса (ERR_MODULE_NOT_FOUND на нашей же строке лога).
process.stderr.write("[e2e-undici-resilience] global fetch dispatcher patched\n");
