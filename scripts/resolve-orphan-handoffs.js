'use strict';

// Resuelve handoffs "huerfanos": filas open/accepted cuya conversacion ya NO esta
// en control humano (restos de takeovers que no cerraron su handoff). Evita que el
// panel muestre "atencion requerida" cuando en realidad no hay nada pendiente.
//
// Uso:
//   node scripts/resolve-orphan-handoffs.js [org-slug]           (dry-run)
//   node scripts/resolve-orphan-handoffs.js [org-slug] --apply   (aplica)
//
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).

try { require('dotenv').config(); } catch (_) { /* dotenv opcional */ }

const { createClient } = require('@supabase/supabase-js');

const slug = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'gh-dent';
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env).'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
    const org = await db.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle();
    if (org.error) throw org.error;
    if (!org.data) { console.error('Organizacion no encontrada:', slug); process.exit(1); }

    const open = await db.from('handoffs').select('id, conversation_id, status').eq('organization_id', org.data.id).in('status', ['open', 'accepted']);
    if (open.error) throw open.error;

    const convIds = [...new Set(open.data.map(h => h.conversation_id))];
    const convs = convIds.length ? await db.from('conversations').select('id, control_mode, status').in('id', convIds) : { data: [] };
    if (convs.error) throw convs.error;
    // Un handoff solo esta "activo" si su conversacion esta en humano Y sigue abierta.
    const active = new Set((convs.data || [])
        .filter(c => c.control_mode === 'human' && ['open', 'waiting'].includes(c.status))
        .map(c => c.id));

    const orphans = open.data.filter(h => !active.has(h.conversation_id));

    console.log(`Organizacion: ${org.data.name} (${org.data.slug})`);
    console.log(`Handoffs abiertos: ${open.data.length} · Huerfanos a resolver: ${orphans.length} · Activos (conversacion en humano): ${open.data.length - orphans.length}`);

    if (!apply) { console.log('\n(dry-run) Anade --apply para aplicar.'); return; }
    if (!orphans.length) { console.log('\nNada que resolver.'); return; }

    const upd = await db.from('handoffs').update({ status: 'resolved', resolved_at: new Date().toISOString() }).in('id', orphans.map(h => h.id));
    if (upd.error) throw upd.error;
    console.log(`\nOK. ${orphans.length} handoffs huerfanos resueltos.`);
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
