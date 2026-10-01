'use strict';

// node scripts/render-roadmap.cjs <flujo-archify.html> <roadmap.html>
// No red, sin dependencias. El JSON es la fuente del estado técnico.
const fs = require('node:fs');
const path = require('node:path');
const roadmap = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/roadmap-piloto.json'), 'utf8'));
const [diagramPath, outputPath] = process.argv.slice(2);
if (!diagramPath || !outputPath) throw new Error('Indica el HTML de Archify y el HTML de salida.');
const diagram = fs.readFileSync(diagramPath, 'utf8');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const data = JSON.stringify(roadmap).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio32 · Roadmap al piloto</title>
<style>
:root{color-scheme:dark;--bg:#0c121c;--panel:#151e2a;--ink:#e8eef5;--muted:#aab8c8;--line:#344255;--accent:#83dfbe}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:34px 24px}h1{font-size:32px;line-height:1.2;margin:8px 0 16px}h2{font-size:23px;margin:28px 0 12px}p{margin:10px 0}.muted{color:var(--muted)}.lead{max-width:850px}.focus{border-left:4px solid var(--accent);padding:14px 20px;background:var(--panel);margin:22px 0}.controls{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:18px 0}label{display:grid;gap:5px;font-size:14px}select,input,textarea,button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:10px;font:inherit}button{cursor:pointer;min-height:44px}input{min-width:220px}select{min-height:44px}iframe{width:100%;height:690px;border:1px solid var(--line);border-radius:12px;background:white}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.task{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:20px;scroll-margin-top:20px}.task h3{font-size:19px;line-height:1.4;margin:9px 0}.tag{display:inline-block;font-size:13px;border:1px solid var(--line);border-radius:6px;padding:2px 8px}.local{color:#83dfbe}.externo{color:#ffd18b}.pendiente{color:#f8b9b9}.despues{color:#b8b8f1}.existing{color:#a7c9ff}.dependency{border:none;padding:2px 6px;color:var(--accent);min-height:32px;text-decoration:underline}details{margin-top:12px}summary{cursor:pointer;padding:6px 0}textarea{width:100%;min-height:95px;resize:vertical}.empty{padding:20px;border:1px solid var(--line)}.light{color-scheme:light;--bg:#f3f5f7;--panel:#fff;--ink:#172334;--muted:#4e5d6d;--line:#bbc6d2;--accent:#08715a}.light .local{color:#086149}.light .externo{color:#855000}.light .pendiente{color:#9d2828}.light .despues{color:#51418e}.light .existing{color:#214e8b}footer{margin:28px 0;color:var(--muted);font-size:14px}@media(max-width:700px){main{padding:22px 14px}h1{font-size:27px}.grid{grid-template-columns:1fr}iframe{height:570px}.controls label{width:100%}input,select{width:100%;min-width:0}}
</style></head><body><main>
<div class="muted">STUDIO32 · Estado comprobado ${escape(roadmap.updated)}</div><h1>Del producto construido al primer piloto</h1>
<p class="lead">${escape(roadmap.goal)}. Avanzamos por hitos con criterios de salida. Tener código o pasar pruebas locales no equivale a estar listo para una clínica.</p>
<div class="focus"><strong>Siguiente tarea: ${escape(roadmap.next)} · Autenticar entradas</strong><br>Proteger webhooks y chat público. En paralelo podemos comprobar elegibilidad y alta de coexistencia. H1–H5 siguen abiertos.</div>
<button id="theme" type="button">Cambiar tema</button>
<h2>Camino y ramas · Archify</h2><p class="muted">Las flechas entre hitos indican puertas de salida. La investigación de proveedores puede avanzar mientras corregimos el núcleo.</p>
<iframe title="Flujo de hitos Studio32 generado y validado con Archify" sandbox="allow-scripts allow-same-origin allow-downloads" srcdoc="${escape(diagram)}"></iframe>
<h2>Tareas y criterios de cierre</h2><p class="muted">Existente: código inspeccionado. Local: corrección probada, sin desplegar. Externo: requiere cuenta o conexión real. Ningún hito está cerrado.</p>
<div class="controls"><label>Hito<select id="phase"><option value="">Todos los hitos</option></select></label><label>Estado<select id="status"><option value="">Todos los estados</option><option value="existente">Existente</option><option value="local">Verificado local</option><option value="pendiente">Pendiente</option><option value="externo">Dependencia externa</option><option value="despues">Después del piloto</option></select></label><label>Buscar<input id="query" type="search" placeholder="Tarea, criterio o evidencia"></label><button id="reset" type="button">Ver todo</button></div>
<p id="count" class="muted" aria-live="polite"></p><div id="tasks" class="grid"></div>
<footer>Fuente versionada: docs/roadmap-piloto.json. Las notas se guardan solo en este navegador; no cambian el estado técnico ni se sincronizan. Precio pendiente: 300 € alta / 150 € mes es una hipótesis. No incluye datos de pacientes ni credenciales.</footer>
</main><script>
const roadmap=${data};
const byId=id=>document.getElementById(id);
const labels={existente:'Existente',local:'Verificado local · sin desplegar',pendiente:'Pendiente',externo:'Dependencia externa',despues:'Después del piloto'};
const text=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const phase of [...new Set(roadmap.tasks.map(t=>t.phase))]){const option=document.createElement('option');option.value=phase;option.textContent=phase;byId('phase').append(option)}
function note(id){try{return localStorage.getItem('studio32-roadmap-note-'+id)||''}catch{return ''}}
function draw(){const phase=byId('phase').value,status=byId('status').value,query=byId('query').value.toLowerCase();const rows=roadmap.tasks.filter(t=>(!phase||t.phase===phase)&&(!status||t.status===status)&&(!query||JSON.stringify(t).toLowerCase().includes(query)));
byId('count').textContent=rows.length+' de '+roadmap.tasks.length+' tareas visibles · avance por evidencia, sin porcentaje de producto terminado';
byId('tasks').innerHTML=rows.map(t=>'<article class="task" id="task-'+t.id+'"><span class="tag '+(t.status==='existente'?'existing':t.status)+'">'+text(labels[t.status])+'</span><h3>'+t.id+' · '+text(t.title)+'</h3><p class="muted">'+text(t.phase)+' · Depende de: '+(t.deps.length?t.deps.map(id=>'<button class="dependency" data-task="'+id+'">'+id+'</button>').join(' '):'sin dependencias')+'</p><p><strong>Para cerrar:</strong> '+text(t.accept)+'</p><details><summary>Evidencia y límites</summary><p>'+text(t.evidence)+'</p></details><details><summary>Mis notas de seguimiento</summary><label>Nota personal para '+t.id+'<textarea data-note="'+t.id+'">'+text(note(t.id))+'</textarea></label><small class="muted">Guardado local al escribir. No introducir datos de pacientes.</small></details></article>').join('')||'<p class="empty">No hay tareas con estos filtros.</p>';
}
for(const id of ['phase','status','query'])byId(id).addEventListener('input',draw);
byId('reset').onclick=()=>{for(const id of ['phase','status','query'])byId(id).value='';draw()};
byId('theme').onclick=()=>document.body.classList.toggle('light');
byId('tasks').addEventListener('input',e=>{if(e.target.dataset.note)try{localStorage.setItem('studio32-roadmap-note-'+e.target.dataset.note,e.target.value)}catch{e.target.setAttribute('aria-description','No se pudo guardar la nota en este navegador.')}});
byId('tasks').addEventListener('click',e=>{const target=e.target.dataset.task;if(target){byId('reset').click();byId('task-'+target).scrollIntoView({behavior:'smooth',block:'start'});byId('task-'+target).animate([{outline:'3px solid var(--accent)'},{outline:'0px solid transparent'}],{duration:1600})}});
draw();
</script></body></html>`;
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
console.log('Roadmap generado: ' + outputPath);
