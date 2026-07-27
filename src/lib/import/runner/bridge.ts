// Мост: собирает ответы из DOM прямым обходом по селекторам шаблона и шлёт parent.
// Внешний <script> (инжектится при очистке), не зависит от их scope. Селекторы и
// порядок проверок зеркалят эталонные getAnswer (reading) / getUserAnswer
// (listening) — источник истины сбора ответов в самих файлах.

// Reading getAnswer(q): drag-token → radio(checked) → text. value = буква / TRUE.. / текст.
const READING_COLLECT = `
function __collect(){
  var a = {};
  for (var q = 1; q <= 40; q++){
    var tok = document.querySelector('.dd-blank[data-q="'+q+'"] .drag-token');
    if (tok){ a[q] = tok.getAttribute('data-value') || ''; continue; }
    var radio = document.querySelector('input[name="q'+q+'"]:checked');
    if (radio){ a[q] = radio.value; continue; }
    var txt = document.querySelector('input.inspera-input-text[name="q'+q+'"]');
    if (txt){ a[q] = txt.value.trim(); continue; }
    a[q] = '';
  }
  return a;
}`;

// Listening getUserAnswer(q): gap → multi(checkbox) → radio → dropzone.
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
    var dz = document.querySelector('.dropzone[data-q="'+q+'"]');
    if (dz){ a[q] = dz.getAttribute('data-value') || ''; continue; }
    a[q] = '';
  }
  return a;
}`;

// targetOrigin = свой origin (iframe и parent на нашем origin); parent дополнительно
// проверяет event.origin при приёме.
const SEND = `function __send(ans){ try{ parent.postMessage({ type: 'ielts-submit', answers: ans || __collect() }, window.location.origin); }catch(e){} }`;

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
