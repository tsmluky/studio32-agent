'use strict';

// Limpia la bandeja marcando como `resolved` las conversaciones de PRUEBA de una
// organización, respetando las reales.
//
// Criterio: una conversación es "de prueba" si el telefono de su contacto NO es
// un numero real (los tests usan identificadores de sesion tipo
// `phase4-knowledge-e2e`, `test-railway-deploy-01`, etc., no un +34...).
//
// Uso:
//   node scripts/cleanup-test-conversations.js [org-slug]            (dry-run)
//   node scripts/cleanup-test-conversations.js [org-slug] --apply    (aplica)
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

    const convs = await db.from('conversations')
        .select('id, contact_id, status, last_message_at')
        .eq('organization_id', org.data.id)
        .in('status', ['open', 'waiting']);
    if (convs.error) throw convs.error;

    const ids = [...new Set(convs.data.map(c => c.contact_id))];
    const contacts = ids.length ? await db.from('contacts').select('id, name, phone').in('id', ids) : { data: [] };
    if (contacts.error) throw contacts.error;
    const cmap = new Map((contacts.data || []).map(c => [c.id, c]));

    const label = c => { const ct = cmap.get(c.contact_id); return `${ct?.name || '(sin nombre)'} · ${ct?.phone || '(sin telefono)'}`; };
    const toResolve = convs.data.filter(c => !isRealPhone(cmap.get(c.contact_id)?.phone));
    const keep = convs.data.filter(c => isRealPhone(cmap.get(c.contact_id)?.phone));

    console.log(`Organizacion: ${org.data.name} (${org.data.slug})`);
    console.log(`Abiertas: ${convs.data.length} · Mantener (reales): ${keep.length} · Resolver (test): ${toResolve.length}`);
    console.log('\nMANTENER:');
    keep.forEach(c => console.log('  +', label(c)));
    console.log('\nRESOLVER:');
    toResolve.forEach(c => console.log('  -', label(c)));

    if (!apply) { console.log('\n(dry-run) Anade --apply para aplicar los cambios.'); return; }
    if (!toResolve.length) { console.log('\nNada que resolver.'); return; }

    const upd = await db.from('conversations').update({ status: 'resolved' }).in('id', toResolve.map(c => c.id));
    if (upd.error) throw upd.error;
    console.log(`\nOK. ${toResolve.length} conversaciones de prueba marcadas como resueltas.`);
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
