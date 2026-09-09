'use strict';

// El guard que impide decir "listo, ya tienes tu cita" cuando no hay ninguna cita.
// Se prueba sin red y sin modelo: es texto entrando y texto saliendo.

const test = require('node:test');
const assert = require('node:assert');

const { daLaCitaPorHecha, horasMencionadas, revisarConfirmacion, NO_CONSTA } = require('../src/confirmacion');

test('reconoce una confirmación de cita', () => {
    const confirman = [
        'Listo, Marta: ya tienes tu cita para la revisión general el jueves a las 09:30.',
        'Hecho, Marta: el jueves a las 10:00. Te espero entonces.',
        'Tu cita está confirmada para mañana a las 09:30.',
        'Te la he apuntado, nos vemos el jueves.',
        'Queda reservada para el lunes.'
    ];
    for (const f of confirman) assert.equal(daLaCitaPorHecha(f), true, f);
});

test('no confunde una oferta, una pregunta ni una frase de cortesía', () => {
    // Estas son respuestas CORRECTAS del agente. Si el guard las tocara, estaría
    // rompiendo conversaciones buenas, que es peor que el problema que resuelve.
    const noConfirman = [
        '¿Te la reservo para las 10:00?',
        'Tengo huecos a las 09:30, 10:00 o 10:30. ¿Cuál te viene mejor?',
        '¡Listo! Cualquier otra duda me dices.',
        'El sábado cerramos. ¿Te viene bien el lunes a las 10:00?',
        'Hoy ya no queda hueco, lo siento.',
        'De hecho, mañana tenemos bastante sitio por la tarde.',
        'La primera visita es gratuita y dura media hora.',
        'El viernes cerramos a las 20:00.'
    ];
    for (const f of noConfirman) assert.equal(daLaCitaPorHecha(f), false, f);
});

test('saca las horas del mensaje, con o sin cero delante', () => {
    assert.deepEqual(horasMencionadas('el jueves a las 9:30 o a las 10.00'), ['09:30', '10:00']);
    assert.deepEqual(horasMencionadas('sin horas aquí'), []);
});

// Un tenant y una agenda de mentira: al guard solo le hace falta poder preguntar
// "¿qué citas activas tiene esta persona?".
function ctxCon(citas) {
    return {
        tenantId: 'falso',
        telefono: 'sesion-1',
        tenant: { id: 'falso', business: { demo: true }, services: { servicios: [] }, _citas: citas }
    };
}

test('si confirma y no hay cita, no deja salir el mensaje', async (t) => {
    const bookings = require('../src/store/bookings');
    t.mock.method(bookings, 'activasDeCliente', async () => []);
    const salida = await revisarConfirmacion(ctxCon([]), 'Listo, Marta: ya tienes tu cita el jueves a las 09:30.');
    assert.equal(salida, NO_CONSTA);
});

test('si confirma y la cita existe a esa hora, no toca nada', async (t) => {
    const bookings = require('../src/store/bookings');
    const original = 'Hecho, Marta: el jueves a las 10:00. Te espero.';
    t.mock.method(bookings, 'activasDeCliente', async () => [{ fecha: '10/09/2026', hora: '10:00', servicio: 'Revisión general' }]);
    assert.equal(await revisarConfirmacion(ctxCon([]), original), original);
});

test('si dice una hora que no es la reservada, la corrige con la de verdad', async (t) => {
    const bookings = require('../src/store/bookings');
    t.mock.method(bookings, 'activasDeCliente', async () => [{ fecha: '10/09/2026', hora: '10:00', servicio: 'Revisión general' }]);
    const salida = await revisarConfirmacion(ctxCon([]), 'Tu cita está confirmada para mañana a las 09:30.');
    assert.match(salida, /10:00/);
    assert.doesNotMatch(salida, /09:30/);
});

test('si la agenda no se puede leer, deja pasar el mensaje original', async (t) => {
    const bookings = require('../src/store/bookings');
    const original = 'Listo, tu cita el jueves a las 10:00.';
    t.mock.method(bookings, 'activasDeCliente', async () => { throw new Error('disco caído'); });
    // Un fallo del guard no puede dejar al cliente sin respuesta.
    assert.equal(await revisarConfirmacion(ctxCon([]), original), original);
});
