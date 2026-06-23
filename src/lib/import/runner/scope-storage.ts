// RUNTIME (per-request) неймспейсинг Web-Storage iframe-раннера по пользователю.
// В отличие от sanitize-runner.ts (import-time, юзер ещё неизвестен) это выполняется в
// авторизованном /runner route, где user.id уже есть. Раннер хранит черновые ответы и
// текстовые выделения в localStorage по ключам, уникальным лишь по ТЕСТУ (STORAGE_KEY /
// HIGHLIGHT_STORAGE_KEY), а режим — в sessionStorage; один браузер с несколькими аккаунтами
// протекал бы клиентским состоянием одного юзера в сессию другого. Инжектим шим ПЕРВЫМ
// скриптом документа: он затеняет window.localStorage И window.sessionStorage обёрткой,
// которая префиксует КАЖДЫЙ ключ неймспейсом `bando:u:<userId>:`. Накрывает любой ключ
// независимо от того, как раннер его строит.

const NS_PREFIX = "bando:u:";

/** Инлайн-скрипт: подменяет window.localStorage и window.sessionStorage на per-user обёртки. */
function shimScript(userId: string): string {
  // Весь неймспейс считается на сервере и встраивается как безопасный JS-литерал
  // (JSON.stringify экранирует кавычки/спецсимволы — defense-in-depth, хотя id это UUID).
  const ns = JSON.stringify(NS_PREFIX + userId + ":");
  return (
    "<script>(function(){" +
    "var NS=" +
    ns +
    ";" +
    // Один враппер на оба Web-Storage. Каждый из localStorage/sessionStorage — configurable
    // аксессор на Window.prototype (Web IDL), НЕ own-property инстанса: defineProperty
    // добавляет own data-property на window, затеняя геттер, поэтому unqualified имя в коде
    // раннера видит шим во всех современных браузерах. try/catch — пер-стор: сбой одного не
    // блокирует другой.
    "function wrap(prop){try{" +
    "var real=window[prop];" +
    // Идемпотентность: если стор уже наш шим — не оборачиваем повторно (двойной префикс
    // bando:u:..:bando:u:..: осиротил бы данные при повторном парсе/инжекте).
    "if(real&&real.__ieltsScoped)return;" +
    // ключи ТОЛЬКО этого неймспейса (для key/length/clear — итерации не должны видеть чужое);
    // длину снапшотим до цикла — оборона от мутации хранилища во время обхода.
    "function nsKeys(){var o=[];for(var i=0,len=real.length;i<len;i++){var k=real.key(i);" +
    "if(k!==null&&k.indexOf(NS)===0)o.push(k);}return o;}" +
    "var shim={__ieltsScoped:true," +
    "getItem:function(k){return real.getItem(NS+k);}," +
    "setItem:function(k,v){real.setItem(NS+k,v);}," +
    "removeItem:function(k){real.removeItem(NS+k);}," +
    "clear:function(){nsKeys().forEach(function(k){real.removeItem(k);});}," +
    // key(i) возвращает ключ БЕЗ префикса — иначе getItem снова добавит NS и промахнётся
    "key:function(i){var ks=nsKeys();var k=ks[i];return k==null?null:k.slice(NS.length);}," +
    "get length(){return nsKeys().length;}" +
    "};" +
    "Object.defineProperty(window,prop,{value:shim,configurable:true,writable:true});" +
    "}catch(e){}}" +
    "wrap('localStorage');wrap('sessionStorage');" +
    "})();</script>"
  );
}

/**
 * Инжектит per-user Web-Storage-шим первым скриптом runner-документа (сразу после `<head>`,
 * до любого скрипта раннера). Возвращает трансформированный html, либо null, если безопасной
 * точки инжекта (`<head>`) нет — вызывающий ОБЯЗАН fail-closed (никогда не отдавать
 * нескоупленный html, это вернуло бы утечку). Реальные файлы тестов всегда имеют `<head>`;
 * null — чисто защитный сигнал.
 */
export function scopeRunnerStorage(html: string, userId: string): string | null {
  if (!userId) return null;
  const shim = shimScript(userId);
  let injected = false;
  const out = html.replace(/<head[^>]*>/i, (m) => {
    injected = true;
    return m + shim;
  });
  return injected ? out : null;
}
