/* Studio32 Agent · widget web embebible.
 * Uso en cualquier web (p. ej. studio32.es):
 *   <script src="https://TU-DOMINIO/widget.js" data-tenant="studio32" defer></script>
 * Opcionales: data-accent="#c9a86a", data-title="Studio32", data-welcome="...".
 * Habla con /chat del mismo dominio del script. Sesión persistente por navegador.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var base = me ? new URL(me.src).origin : location.origin;
  var tenant = (me && me.getAttribute('data-tenant')) || 'studio32';
  var accent = (me && me.getAttribute('data-accent')) || '#c9a86a';
  var title = (me && me.getAttribute('data-title')) || 'Studio32';
  var welcome = (me && me.getAttribute('data-welcome')) || 'Hola, ¿en qué te ayudo?';

  var KEY = 's32_sesion_' + tenant;
  var sesion = localStorage.getItem(KEY);
  if (!sesion) { sesion = 'web-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(KEY, sesion); }

  var css = ''
    + '.s32w-btn{position:fixed;bottom:22px;right:22px;width:58px;height:58px;border-radius:50%;background:' + accent + ';color:#090908;border:none;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.35);z-index:2147483000;display:flex;align-items:center;justify-content:center;}'
    + '.s32w-btn svg{width:26px;height:26px;}'
    + '.s32w-panel{position:fixed;bottom:92px;right:22px;width:360px;max-width:calc(100vw - 36px);height:520px;max-height:calc(100vh - 120px);background:#15140f;color:#f6f0e5;border:1px solid #2c2a22;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Inter,system-ui,sans-serif;}'
    + '.s32w-panel.open{display:flex;}'
    + '.s32w-head{padding:14px 16px;border-bottom:1px solid #2c2a22;display:flex;align-items:center;gap:8px;}'
    + '.s32w-head b{font-size:15px;font-weight:600;}'
    + '.s32w-head .s32w-x{margin-left:auto;background:none;border:none;color:#9b958a;font-size:20px;cursor:pointer;line-height:1;}'
    + '.s32w-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;}'
    + '.s32w-m{max-width:82%;padding:9px 13px;border-radius:13px;font-size:14px;line-height:1.45;white-space:pre-wrap;}'
    + '.s32w-bot{background:#1e1c16;border:1px solid #2c2a22;align-self:flex-start;border-bottom-left-radius:4px;}'
    + '.s32w-user{background:#2a2418;align-self:flex-end;border-bottom-right-radius:4px;}'
    + '.s32w-foot{display:flex;gap:8px;padding:12px;border-top:1px solid #2c2a22;}'
    + '.s32w-foot input{flex:1;background:#0f0e0a;color:#f6f0e5;border:1px solid #2c2a22;border-radius:999px;padding:10px 14px;font-size:14px;outline:none;}'
    + '.s32w-foot input:focus{border-color:' + accent + ';}'
    + '.s32w-foot button{background:' + accent + ';color:#090908;border:none;border-radius:999px;padding:0 16px;font-weight:600;cursor:pointer;}'
    + '.s32w-foot button:disabled{opacity:.5;}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.className = 's32w-btn'; btn.setAttribute('aria-label', 'Abrir chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>';

  var panel = document.createElement('div'); panel.className = 's32w-panel';
  panel.innerHTML =
    '<div class="s32w-head"><b>' + title + '</b><button class="s32w-x" aria-label="Cerrar">×</button></div>' +
    '<div class="s32w-msgs"></div>' +
    '<div class="s32w-foot"><input type="text" placeholder="Escribe aquí…" /><button>Enviar</button></div>';

  document.body.appendChild(btn); document.body.appendChild(panel);
  var msgs = panel.querySelector('.s32w-msgs');
  var input = panel.querySelector('input');
  var send = panel.querySelector('.s32w-foot button');
  var started = false;

  function add(text, who) {
    var el = document.createElement('div');
    el.className = 's32w-m ' + (who === 'user' ? 's32w-user' : 's32w-bot');
    el.textContent = text; msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; return el;
  }
  function toggle() {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      if (!started) { add(welcome, 'bot'); started = true; }
      input.focus();
    }
  }
  btn.onclick = toggle;
  panel.querySelector('.s32w-x').onclick = toggle;

  async function enviar() {
    var texto = input.value.trim(); if (!texto) return;
    add(texto, 'user'); input.value = ''; send.disabled = true;
    var pen = add('…', 'bot');
    try {
      var r = await fetch(base + '/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: tenant, sesion: sesion, mensaje: texto })
      });
      var data = await r.json();
      pen.textContent = data.respuesta || '(sin respuesta)';
    } catch (e) { pen.textContent = 'No he podido conectar. Inténtalo de nuevo.'; }
    finally { send.disabled = false; input.focus(); }
  }
  send.onclick = enviar;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') enviar(); });

  // API pública mínima para integraciones (p. ej. formulario de reservas de la web)
  window.S32W = {
    open: function () { if (!panel.classList.contains('open')) toggle(); },
    send: function (texto) {
      if (!panel.classList.contains('open')) toggle();
      input.value = String(texto || '');
      enviar();
    }
  };
})();
