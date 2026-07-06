'use strict';

// Punto de entrada de la capa de persistencia. El resto de la app importa
// desde aquí: require('./store').bookings, .leads, etc.

module.exports = {
    conversations: require('./conversations'),
    bookings: require('./bookings'),
    leads: require('./leads'),
    logs: require('./logs'),
    usage: require('./usage')
};
