'use strict';

// Fechas y horas EN LA ZONA DEL NEGOCIO. El servidor corre en UTC, así que
// cualquier `new Date()` pelado se desfasa de España y, de madrugada, cambia
// incluso el día. Todo lo que decida "qué día es hoy" o "qué hora es ahora"
// debe pasar por aquí.

const TZ_POR_DEFECTO = 'Europe/Madrid';

// { y, m, d, dow, hh, mm } en la zona indicada.
function partesEnZona(date, timezone) {
    const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || TZ_POR_DEFECTO,
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const leer = (t) => p.find(x => x.type === t)?.value || '';
    return {
        y: Number(leer('year')), m: Number(leer('month')), d: Number(leer('day')),
        dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(leer('weekday')),
        hh: Number(leer('hour')), mm: Number(leer('minute'))
    };
}

// "DD/MM/YYYY" de hoy en la zona del negocio.
function hoyDDMMYYYY(timezone) {
    const { y, m, d } = partesEnZona(new Date(), timezone);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d)}/${p(m)}/${y}`;
}

// Minutos transcurridos del día ahora mismo, en la zona del negocio.
function minutosAhora(timezone) {
    const { hh, mm } = partesEnZona(new Date(), timezone);
    return hh * 60 + mm;
}

// Compara una fecha DD/MM/YYYY con hoy en la zona: -1 pasada, 0 hoy, 1 futura.
// Devuelve null si la cadena no es una fecha válida.
function compararConHoy(fechaStr, timezone) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(fechaStr || '').trim());
    if (!m) return null;
    const pedida = Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
    const t = partesEnZona(new Date(), timezone);
    const hoy = t.y * 10000 + t.m * 100 + t.d;
    return pedida < hoy ? -1 : (pedida === hoy ? 0 : 1);
}

module.exports = { partesEnZona, hoyDDMMYYYY, minutosAhora, compararConHoy, TZ_POR_DEFECTO };
