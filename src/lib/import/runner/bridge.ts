// Мост: собирает ответы из DOM прямым обходом по селекторам шаблона и шлёт parent.
// Внешний <script> (инжектится при очистке), не зависит от их scope. Селекторы и
// порядок проверок зеркалят эталонные getAnswer (reading) / getUserAnswer
// (listening) — источник истины сбора ответов в самих файлах.

// Reading getAnswer(q): drag-token → checkbox-group(choose TWO/THREE) → radio → text.
// multi (#7): checkboxes live in a [data-mcq-group] block (range "8-12" or list "4,5"),
// NOT per-question. Every member q of the group reports the SAME full set of checked
// letters (comma-joined) — grade.ts mcq_set compares the full set per member. Mirrors the
// listening __multiFor pattern (covers both .mcq-block and .mc-question conventions).
export const READING_COLLECT = `
function __readingMultiFor(q){
  var groups = document.querySelectorAll('[data-mcq-group]');
  for (var i = 0; i < groups.length; i++){
    var raw = groups[i].getAttribute('data-mcq-group') || '';
    var members = [];
    if (raw.indexOf('-') !== -1){
      var lo = parseInt(raw.split('-')[0], 10), hi = parseInt(raw.split('-')[1], 10);
      for (var n = lo; n <= hi; n++) members.push(n);
    } else {
      members = raw.split(',').map(function(s){ return parseInt(s, 10); });
    }
    if (members.indexOf(q) !== -1){
      return Array.prototype.slice.call(groups[i].querySelectorAll('input[type="checkbox"]'))
        .filter(function(c){ return c.checked; })
        .map(function(c){ return c.value; })
        .sort()
        .join(',');
    }
  }
  return null;
}
function __collect(){
  var a = {};
  for (var q = 1; q <= 40; q++){
    var tok = document.querySelector('.dd-blank[data-q="'+q+'"] .drag-token');
    if (tok){ a[q] = tok.getAttribute('data-value') || ''; continue; }
    // Inspera drag-drop: heading-токен (Matching Headings) и ending-токен (Sentence
    // Endings) лежат в #drop-qN, ответ — в data-heading / data-ending (зеркалит getAnswer).
    var head = document.querySelector('#drop-q'+q+' .heading-token');
    if (head){ a[q] = head.getAttribute('data-heading') || ''; continue; }
    var end = document.querySelector('#drop-q'+q+' .ending-token');
    if (end){ a[q] = end.getAttribute('data-ending') || ''; continue; }
    var multi = __readingMultiFor(q);
    if (multi !== null){ a[q] = multi; continue; }
    var radio = document.querySelector('input[name="q'+q+'"]:checked');
    if (radio){ a[q] = radio.value; continue; }
    // Text-fallback зеркалит getAnswer (голый input[name=qN]) — устойчивее к отсутствию
    // класса .inspera-input-text. type-гейт исключает checkbox/radio: незаполненный radio
    // (первый input группы) не должен перебить пустой a[q]='' на своё имя-значение.
    var txt = document.querySelector('input[name="q'+q+'"]');
    if (txt && txt.type !== 'checkbox' && txt.type !== 'radio'){ a[q] = txt.value.trim(); continue; }
    a[q] = '';
  }
  return a;
}`;

// Listening getUserAnswer(q): gap → multi(checkbox) → radio → place-chip(map
// labelling) → dropzone.
// multi: чекбоксы в .mcq.multi[data-qs="N1,N2"] без name; выбранные буквы
// СОРТИРУЮТСЯ и раздаются по позиции (letters[0]→первый q группы и т.д.) —
// иначе text_accept-грейд по KEY[q] не сойдётся.
const LISTENING_COLLECT = `
function __multiFor(q){
  var groups = document.querySelectorAll('.mcq.multi[data-qs]');
  for (var i = 0; i < groups.length; i++){
    var qs = groups[i].getAttribute('data-qs').split(',').map(function(s){ return parseInt(s, 10); });
    if (qs.indexOf(q) !== -1){
      var checked = Array.prototype.slice.call(groups[i].querySelectorAll('input[type="checkbox"]'))
        .filter(function(c){ return c.checked; })
        .map(function(c){ return c.value; })
        .sort();
      return checked[qs.indexOf(q)] || '';
    }
  }
  return null;
}
function __collect(){
  var a = {};
  for (var q = 1; q <= 40; q++){
    var gap = document.querySelector('.gap[data-q="'+q+'"]');
    if (gap){ a[q] = gap.value.trim(); continue; }
    var m = __multiFor(q);
    if (m !== null){ a[q] = m; continue; }
    var radio = document.querySelector('input[name="q'+q+'"]:checked');
    if (radio){ a[q] = radio.value; continue; }
    // map labelling: чип отвечает за N, буква зоны — с ближайшего .map-dz-родителя
    // (зеркалит getUserAnswer). Сперва РАЗМЕЩЁННЫЕ чипы (внутри .map-dz): при дубле
    // банк+зона голый querySelector взял бы первый (банковский) и вернул ''; при ДВУХ
    // размещённых — произвольный. Больше одного размещённого = неоднозначно → '' (fail-
    // closed, как «не размещён»). Ровно один → его буква; ни одного → любой чип (в банке → '').
    var placed = document.querySelectorAll('.map-dz .place-chip[data-q="'+q+'"]');
    if (placed.length > 1){ a[q] = ''; continue; }
    var pc = placed[0] || document.querySelector('.place-chip[data-q="'+q+'"]');
    if (pc){ var zone = pc.closest('.map-dz'); a[q] = zone ? (zone.getAttribute('data-letter') || '') : ''; continue; }
    var dz = document.querySelector('.dropzone[data-q="'+q+'"]');
    if (dz){ a[q] = dz.getAttribute('data-value') || ''; continue; }
    a[q] = '';
  }
  return a;
}`;

// Раннер исполняется в opaque origin (iframe sandbox без allow-same-origin): там
// window.location.origin === "null", а postMessage(data, "null") бросает — поэтому
// targetOrigin = "*". Безопасно: parent валидирует отправителя по идентичности окна
// (e.source === iframe.contentWindow в ExamFrame), а не по origin.
const SEND = `function __send(ans){ try{ parent.postMessage({ type: 'ielts-submit', answers: ans || __collect() }, '*'); }catch(e){} }`;

// Reading: оба пути сабмита (deliver-кнопка и autoSubmitMock) зовут markOnPage()
// затем showResults() — глушим разметку (ключи вырезаны) и перехватываем сабмит.
export const READING_BRIDGE = `<script>(function(){${READING_COLLECT}
  ${SEND}
  window.markOnPage = function(){};
  window.showResults = function(){ __send(); };
})();</script>`;

// Listening: и кнопка, и авто-сабмит по таймеру идут через #doSubmit.onclick
// (таймер зовёт onclick({skipConfirm:true})). Сохраняем confirm незаполненных — UX.
export const LISTENING_BRIDGE = `<script>(function(){${LISTENING_COLLECT}
  ${SEND}
  function __hook(){
    if (!document.getElementById('doSubmit')){ return setTimeout(__hook, 200); }
    document.getElementById('doSubmit').onclick = function(opts){
      var ans = __collect();
      if (!(opts && opts.skipConfirm)){
        var blank = 0;
        for (var q = 1; q <= 40; q++){ if (ans[q] === '' || ans[q] == null) blank++; }
        if (blank > 0 && !confirm('You still have ' + blank + ' unanswered question' + (blank > 1 ? 's' : '') + '. Submit anyway?')) return;
      }
      __send(ans);
    };
  }
  __hook();
})();</script>`;

// Read-time миграция legacy-рядов. runner_html, импортированные ДО P0-изоляции, несут в
// bridge `targetOrigin = window.location.origin`. После снятия allow-same-origin раннер в
// opaque origin → window.location.origin === "null", postMessage(data, "null") бросает, и
// сабмит молча не уходит. Точечно переписываем targetOrigin ИМЕННО ielts-submit-сообщения
// на "*" (фикстуры собственный window.location.origin не используют — единственный матч это
// инжектированный SEND). No-op для новых рядов (SEND уже эмитит "*").
export function retargetBridgeOrigin(html: string): string {
  return html.replace(
    /(parent\.postMessage\(\s*\{\s*type:\s*['"]ielts-submit['"][\s\S]*?\}\s*),\s*window\.location\.origin\s*\)/g,
    "$1, '*')",
  );
}

// Practice-only аудио-мост (listening ∧ mode='practice'): ставит внешние practice-
// контролы (перемотка/Replay/скорость/play-pause) на нативный <audio id="audio"> раннера,
// не трогая его собственный UI/гейт/таймер. Отдельный <script>-тег (как READING/LISTENING
// BRIDGE): всё через глобали (getElementById/window.parent/addEventListener), IIFE ничего
// не оставляет в window.
//
// Безопасность (не ослабляет sandbox/CSP): внутрь принимаются ТОЛЬКО сообщения parent'а
// (`e.source === window.parent`) — зеркалит parent-сторону (ExamFrame принимает
// `e.source === iframe.contentWindow`); наружу уходят лишь позиция/длительность/скорость
// (никаких ключей/ответов). targetOrigin '*' безопасен по той же причине, что и в SEND:
// opaque origin (`window.location.origin === "null"`), а стороны валидируют отправителя по
// идентичности окна, не по origin. postMessage — не connect-src, `connect-src 'none'` цел.
const PRACTICE_AUDIO_MARK = "bando-practice-audio-bridge";
export const PRACTICE_AUDIO_BRIDGE = `<script>/* ${PRACTICE_AUDIO_MARK} */(function(){
  var audio = document.getElementById('audio');
  if(!audio) return;
  function post(){
    try{
      parent.postMessage({
        type: 'ielts-audio-state',
        time: isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: isFinite(audio.duration) ? audio.duration : 0,
        playing: !audio.paused,
        rate: audio.playbackRate || 1
      }, '*');
    }catch(e){}
  }
  ['timeupdate','loadedmetadata','durationchange','play','pause','ended','seeked','ratechange'].forEach(function(ev){
    audio.addEventListener(ev, post);
  });
  // 'play' сначала прогоняет ШТАТНЫЙ старт раннера (клик по #playBtn раскрывает вопросы и
  // заводит его таймер) — только если кнопка активна; иначе прямой audio.play() (форсит load).
  function startIfNeeded(){
    var btn = document.getElementById('playBtn');
    var overlay = document.getElementById('playOverlay');
    if(btn && overlay && !overlay.classList.contains('hidden') && !btn.disabled){ btn.click(); return true; }
    return false;
  }
  window.addEventListener('message', function(e){
    if(e.source !== window.parent) return;
    var d = e.data || {};
    if(d.type !== 'ielts-audio-cmd') return;
    try{
      var a = d.action;
      if(a === 'play'){ if(!startIfNeeded()){ audio.play().catch(function(){}); } }
      else if(a === 'pause'){ audio.pause(); }
      else if(a === 'replay'){ startIfNeeded(); audio.currentTime = 0; audio.play().catch(function(){}); }
      else if(a === 'seek' && typeof d.value === 'number' && isFinite(d.value)){ audio.currentTime = Math.max(0, d.value); }
      else if(a === 'rate' && typeof d.value === 'number' && isFinite(d.value)){ audio.playbackRate = d.value; }
    }catch(err){}
    post();
  });
  post();
})();</script>`;

/**
 * Инжектит practice-аудио-мост перед закрывающим </html> (fallback — дописать в хвост).
 * Идемпотентно (маркер `bando-practice-audio-bridge`). No-op, если в документе нет
 * <audio id="audio"> (reading-раннер без плеера) — тогда мостить нечего. Аддитивно: удаление
 * ровно вставленной строки восстанавливает исходный HTML (инвариант «mock байт-в-байт»
 * держится тем, что для mock этот инжект вообще не вызывается — см. renderRunnerDocument).
 */
export function injectPracticeAudioBridge(html: string): string {
  if (html.includes(PRACTICE_AUDIO_MARK)) return html; // уже пропатчено
  if (!/id=["']audio["']/.test(html)) return html; // нет плеера — нечего мостить
  const idx = html.lastIndexOf("</html>");
  if (idx === -1) return html + PRACTICE_AUDIO_BRIDGE; // нет </html> — в хвост
  return html.slice(0, idx) + PRACTICE_AUDIO_BRIDGE + html.slice(idx);
}
