'use strict';

// Vigilancia del agente desplegado. Responde a una sola pregunta:
//
//   ¿nos enteramos nosotros antes que el cliente de que esto se ha caído?
//
// Hasta ahora, no. Si el agente dejaba de responder un domingo por la tarde, lo
// descubría el paciente que quería cita.
//
//   node scripts/vigilar.js [--url <url>] [--tenant <id>]
//
// Sale con código 1 si algo va mal, y ESE es el aviso: lo lanza GitHub Actions cada
// media hora (.github/workflows/vigilancia.yml) y un fallo manda un correo solo.
//
// Es deliberadamente más barato que el smoke: dos comprobaciones, no siete. El smoke
// dice si el agente hace bien su trabajo; esto dice si está vivo.

// El .env por si se lanza a mano desde el portátil: así usa el SMOKE_TOKEN y no gasta
// cupo de la demo. En GitHub Actions no hay .env y funciona igual, sin secretos.
try { require('dotenv').config(); } catch (_) { /* no siempre está instalado */ }

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i !== -1 && args[i + 1] ? args[i + 1] : d; };

const URL_BASE = opt('url', process.env.VIGILAR_URL || 'https://web-production-d722c.up.railway.app').replace(/\/$/, '');
const TENANT = opt('tenant', 'clinica-cobalto');

// Una conversación por día: ni una nueva cada media hora ensuciando el historial, ni
// una sola creciendo para siempre.
const SESION = `vigilancia-${new Date().toISOString().slice(0, 10)}`;

const V = '\x1b[32m✓\x1b[0m';
const X = '\x1b[31m✗\x1b[0m';
const problemas = [];

async function conReintento(url, opciones, intentos = 3) {
    let ultimo;
    for (let i = 1; i <= intentos; i++) {
        try { return await fetch(url, { ...opciones, signal: AbortSignal.timeout(45000) }); }
        catch (err) { ultimo = err; if (i < intentos) await new Promise(r => setTimeout(r, 3000 * i)); }
    }
    throw new Error(`sin respuesta tras ${intentos} intentos (${ultimo.message})`);
}

async function salud() {
    const r = await conReintento(`${URL_BASE}/health`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(`/health responde ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    // El volumen es lo que sostiene la agenda. Sin él, cada despliegue borra las citas
    // y se puede citar a dos personas a la misma hora sin que nadie lo note.
    if (!j.volumen || !j.volumen.escribible) throw new Error('el volumen de datos NO se puede escribir: las citas no sobrevivirían al próximo despliegue');
    if (!j.tenants) throw new Error('el servidor no ve ningún negocio configurado');
    return `${j.modelo.proveedor}/${j.modelo.modelo} · ${j.tenants} negocios · lleva ${Math.round(j.arrancado_hace_s / 60)} min en pie`;
}

async function contesta() {
    const r = await conReintento(`${URL_BASE}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.SMOKE_TOKEN ? { 'x-smoke-token': process.env.SMOKE_TOKEN } : {}) },
        body: JSON.stringify({ tenant: TENANT, sesion: SESION, mensaje: '¿Qué horario tenéis?' })
    });
    const j = await r.json().catch(() => ({}));
    const texto = (j.respuesta || '').trim();
    // Un 429 NO es una caída: el servicio está en pie y aplicando sus propios topes de
    // demostración. Hacer sonar la alarma por esto entrena a ignorarla, que es la
    // manera más rápida de que una vigilancia no sirva para nada.
    if (r.status === 429) return 'en pie, aunque hoy esta IP ya ha agotado el cupo de la demo';
    if (!r.ok) throw new Error(`el chat responde ${r.status}: ${JSON.stringify(j).slice(0, 120)}`);
    if (!texto) throw new Error('el agente ha contestado con un mensaje vacío');
    // Sus frases de rendición. Un 200 con esto dentro es una caída disfrazada: el
    // servidor está en pie y el cliente se queda igual de tirado.
    if (/se me ha cruzado algo|no consigo responderte|me lo repites/i.test(texto)) {
        throw new Error(`el agente está en pie pero se rinde: "${texto.slice(0, 90)}"`);
    }
    return `"${texto.replace(/\n/g, ' ').slice(0, 70)}…"`;
}

(async () => {
    console.log(`\n=== Vigilancia · ${URL_BASE} ===\n`);
    for (const [nombre, fn] of [['está vivo y con el disco montado', salud], ['contesta como una persona esperaría', contesta]]) {
        try {
            const detalle = await fn();
            console.log(`  ${V} ${nombre}\n      ${detalle}`);
        } catch (err) {
            problemas.push(`${nombre}: ${err.message}`);
            console.log(`  ${X} ${nombre}\n      ${err.message}`);
        }
    }
    if (problemas.length) {
        console.log(`\n  EL AGENTE NO ESTÁ BIEN:\n${problemas.map(p => '   • ' + p).join('\n')}\n`);
        process.exit(1);
    }
    console.log('\n  Todo en orden.\n');
})();
