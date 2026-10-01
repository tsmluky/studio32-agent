'use strict';

// La consulta y las escrituras deben usar las mismas reglas del negocio.
function parsearFecha(valor) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || ''));
    if (!match) return new Date(NaN);
    const [, dia, mes, anio] = match.map(Number);
    const fecha = new Date(anio, mes - 1, dia);
    return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia
        ? fecha : new Date(NaN);
}

function horaAMin(valor) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(valor || ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function franjasDelDia(horario, fecha) {
    const porDia = horario.franjas_por_dia;
    const franjas = porDia && Object.hasOwn(porDia, fecha.getDay())
        ? porDia[fecha.getDay()] : horario.franjas || [];
    return franjas.map(f => ({ inicio: horaAMin(f.inicio), fin: horaAMin(f.fin) }));
}

function serviciosActivos(tenant) {
    return (tenant.services?.servicios || []).filter(s => s.activo !== false && s.active !== false);
}

module.exports = { parsearFecha, horaAMin, franjasDelDia, serviciosActivos };
