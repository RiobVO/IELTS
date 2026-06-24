// RUNTIME (read-time) in-memory полифил Web-Storage для iframe-раннера.
//
// Раннер исполняется в OPAQUE origin (iframe sandbox без allow-same-origin — P0-изоляция):
// в opaque-origin документе ДОСТУП к window.localStorage / window.sessionStorage БРОСАЕТ
// SecurityError (HTML spec, getter-шаги для opaque origin). Reading-раннер зовёт localStorage
// без guard на init (loadState/saveState) → без подмены экзамен падает белым экраном.
//
// Поэтому подменяем оба Web-Storage синхронным in-memory объектом, реализующим интерфейс
// Storage (getItem/setItem/removeItem/clear/key/length). КЛЮЧЕВОЕ отличие от прежнего
// per-user namespacing-шима: мы НИКОГДА не читаем нативный window[prop] (он бросает). Сам
// namespacing больше не нужен — opaque origin не делит персистентное хранилище между
// аккаунтами в одном браузере, поэтому утечки черновика между сессиями структурно нет.
//
// Цена: resume между перезагрузками теряется (in-memory живёт до reload). Допустимо: у
// iframe-трека и так нет серверного autosave (spec §5), а reading loadState рано выходит на
// getItem===null. Покрывает только method-доступ (getItem/setItem/removeItem) — именно его
// используют фикстуры; bracket/property-доступ как к нативному Storage не поддерживается.

// window.localStorage / window.sessionStorage — configurable аксессоры на Window.prototype
// (WindowLocalStorage/WindowSessionStorage mixin). Object.defineProperty ставит own
// data-property на window, затеняя бросающий прототипный геттер: unqualified `localStorage`
// в коде раннера видит наш полифил и не триггерит нативный throw. mk() даёт независимый стор
// на каждый из local/session. try/catch — пер-стор: сбой одного не блокирует другой.
const SHIM =
  "<script>(function(){" +
  "function mk(){" +
  "var m=Object.create(null);" +
  "var s={" +
  "getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;}," +
  "setItem:function(k,v){m[String(k)]=String(v);}," +
  "removeItem:function(k){delete m[String(k)];}," +
  "clear:function(){Object.keys(m).forEach(function(k){delete m[k];});}," +
  "key:function(i){var ks=Object.keys(m);return i>=0&&i<ks.length?ks[i]:null;}" +
  "};" +
  "Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length;}});" +
  "return s;" +
  "}" +
  "try{Object.defineProperty(window,'localStorage',{value:mk(),configurable:true,writable:true});}catch(e){}" +
  "try{Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true,writable:true});}catch(e){}" +
  "})();</script>";

/**
 * Инжектит in-memory Web-Storage-полифил первым скриптом runner-документа (сразу после
 * `<head>`, до любого скрипта раннера). Возвращает трансформированный html, либо null, если
 * безопасной точки инжекта (`<head>`) нет — вызывающий ОБЯЗАН fail-closed (иначе отдал бы
 * раннер, падающий на первом обращении к localStorage в opaque origin). Реальные файлы
 * тестов всегда имеют `<head>`; null — чисто защитный сигнал.
 */
export function polyfillRunnerStorage(html: string): string | null {
  let injected = false;
  const out = html.replace(/<head[^>]*>/i, (m) => {
    injected = true;
    return m + SHIM;
  });
  return injected ? out : null;
}
