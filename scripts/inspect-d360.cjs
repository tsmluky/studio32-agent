'use strict';
// Solo lectura y sin contenido/identidades de pacientes en el resumen.
require('dotenv').config({ quiet: true });
const db = require('../src/store/_db');
function inspect(tenantId) {
    const all = db.leer(tenantId, 'd360-inbox.json', {});
    const counts = {}, review = [];
    for (const [id, row] of Object.entries(all)) {
        counts[row.state] = (counts[row.state] || 0) + 1;
        if (['processing', 'sending', 'delivery_uncertain', 'review_required', 'unsupported'].includes(row.state)) {
            review.push({ eventKey: id, state: row.state, kind: row.event.kind, type: row.event.type || null, receivedAt: row.receivedAt });
        }
    }
    return { total: Object.keys(all).length, counts, review };
}
if (require.main === module) {
    try { console.log(JSON.stringify(inspect(process.argv[2]), null, 2)); }
    catch (_) { console.error('No se pudo inspeccionar el inbox: comprueba tenant y volumen.'); process.exitCode = 1; }
}
module.exports = { inspect };
