'use strict';

// Borra las citas (appointments) de PRUEBA de una organizacion, respetando las
// reales. Los scripts de conversaciones/handoffs no tocan `appointments`, y las
// citas de test (Paciente Demo, Juanma E2E, Laura E2E...) SI son visibles en la
// vista Citas del panel del cliente. Cancelarlas no las oculta (la vista muestra
// tambien las canceladas), por eso este script BORRA.
//
// Criterio: una cita es "de prueba" si el telefono de su contacto NO es un numero
// real (los tests usan identificadores de sesion, no un +34...). Mismo criterio
// que cleanup-test-conversations.js.
//
// Uso:
//   node scripts/cleanup-test-appointments.js [org-slug]            (dry-run)
//   node scripts/cleanup-test-appointments.js [org-slug] --apply    (aplica: BORRA)
//
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).

try { require('dotenv').config(); } catch (_) { /* dotenv opcional */ }

const { createClient } = require('@supabase/supabase-js');

const slug = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'gh-dent';
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).');
    process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const isRealPhone = p => /^\+?\d{6,}$/.test(String(p || '').trim());

(async () => {
    const org = await db.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle();
    if (org.error) throw org.error;
    if (!org.data) { console.error('Organizacion no encontrada:', slug); process.exit(1); }

    const appts = await db.from('appointments')
        .select('id, contact_id, status, starts_at, resource_name')
        .eq('organization_id', org.data.id);
    if (appts.error) throw appts.error;

    const ids = [...new Set(appts.data.map(a => a.contact_id).filter(Boolean))];
    const contacts = ids.length ? await db.from('contacts').select('id, name, phone').in('id', ids) : { data: [] };
    if (contacts.error) throw contacts.error;
    const cmap = new Map((contacts.data || []).map(c => [c.id, c]));

    const label = a => {
        const ct = cmap.get(a.contact_id);
        const when = String(a.starts_at || '').replace('T', ' ').slice(0, 16);
        return `${when} - ${ct?.name || '(sin nombre)'} / ${ct?.phone || '(sin telefono)'} [${a.status}]${a.resource_name ? ' <' + a.resource_name + '>' : ''}`;
    };
    const toDelete = appts.data.filter(a => !isRealPhone(cmap.get(a.contact_id)?.phone));
    const keep = appts.data.filter(a => isRealPhone(cmap.get(a.contact_id)?.phone));

    console.log(`Organizacion: ${org.data.name} (${org.data.slug})`);
    console.log(`Citas: ${appts.data.length} - Mantener (reales): ${keep.length} - Borrar (test): ${toDelete.length}`);
    console.log('\nMANTENER:');
    keep.forEach(a => console.log('  +', label(a)));
    console.log('\nBORRAR:');
    toDelete.forEach(a => console.log('  -', label(a)));

    if (!apply) { console.log('\n(dry-run) Anade --apply para BORRAR las citas de prueba.'); return; }
    if (!toDelete.length) { console.log('\nNada que borrar.'); return; }

    const del = await db.from('appointments').delete().in('id', toDelete.map(a => a.id));
    if (del.error) throw del.error;
    console.log(`\nOK. ${toDelete.length} citas de prueba borradas.`);
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
