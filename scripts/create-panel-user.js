'use strict';

// Aprovisiona un usuario del panel de Studio32 Agent Platform.
//
// Hace dos cosas de una sola vez:
//   1) Crea el usuario en Supabase Auth (email + contraseña, ya confirmado).
//   2) Lo vincula a una organización en `organization_members` con rol `owner`.
//
// El trigger `on_auth_user_created` crea el `profiles` automáticamente, así que
// no hay que tocarlo.
//
// Uso:
//   node scripts/create-panel-user.js <email> <password> [org-slug]
//
// Requiere en el entorno (o en un archivo .env en la raíz del repo):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Es idempotente: si el usuario ya existe, lo reutiliza; si ya es miembro,
// actualiza el rol a owner sin duplicar.

try { require('dotenv').config(); } catch (_) { /* dotenv opcional */ }

const { createClient } = require('@supabase/supabase-js');

const [, , email, password, slug = 'gh-dent'] = process.argv;
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password) {
    console.error('Uso: node scripts/create-panel-user.js <email> <password> [org-slug]');
    process.exit(1);
}
if (!url || !serviceKey) {
    console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env o variables).');
    process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
    // 1) Localizar la organización por slug.
    const org = await db.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle();
    if (org.error) throw org.error;
    if (!org.data) {
        const all = await db.from('organizations').select('slug').order('slug');
        const slugs = (all.data || []).map(o => o.slug).join(', ') || '(ninguna)';
        console.error(`No existe organización con slug '${slug}'. Slugs disponibles: ${slugs}`);
        process.exit(1);
    }

    // 2) Crear el usuario de Auth (o reutilizarlo si ya existe).
    let userId;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) {
        if (/already|exists|registered/i.test(created.error.message)) {
            const list = await db.auth.admin.listUsers();
            if (list.error) throw list.error;
            const existing = (list.data.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
            if (!existing) throw created.error;
            userId = existing.id;
            // Reafirmar la contraseña indicada por si el usuario la olvidó.
            const upd = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
            if (upd.error) throw upd.error;
            console.log('Usuario ya existía; contraseña actualizada. id:', userId);
        } else {
            throw created.error;
        }
    } else {
        userId = created.data.user.id;
        console.log('Usuario creado. id:', userId);
    }

    // 3) Vincular como owner (idempotente).
    const member = await db.from('organization_members')
        .upsert({ organization_id: org.data.id, user_id: userId, role: 'owner' }, { onConflict: 'organization_id,user_id' })
        .select()
        .maybeSingle();
    if (member.error) throw member.error;

    console.log('');
    console.log('OK. Usuario del panel aprovisionado:');
    console.log('   Organizacion:', org.data.name, `(${org.data.slug})`);
    console.log('   Email:       ', email);
    console.log('   Rol:          owner');
    console.log('');
    console.log('Ya puedes entrar en el panel con ese email y esa contraseña.');
})().catch(err => {
    console.error('ERROR:', err.message || err);
    process.exit(1);
});
