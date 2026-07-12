'use strict';

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
const sql = migrations.map(name => fs.readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n');
const requiredTables = [
    'organizations', 'profiles', 'organization_members', 'channel_accounts',
    'contacts', 'conversations', 'messages', 'services', 'appointments', 'leads',
    'agent_configs', 'handoffs', 'integrations', 'audit_logs'
];

const failures = [];
for (const table of requiredTables) {
    if (!new RegExp(`create table public\\.${table}\\s*\\(`, 'i').test(sql)) failures.push(`missing table: ${table}`);
    if (!new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(sql)) failures.push(`RLS not enabled: ${table}`);
}
for (const fragment of ['control_mode', 'provider_message_id', 'external_calendar_event_id', 'is_organization_member', 'has_organization_role']) {
    if (!sql.includes(fragment)) failures.push(`missing contract fragment: ${fragment}`);
}
for (const fragment of ['conversations_contact_same_org', 'messages_conversation_same_org', 'appointments_service_same_org', 'handoffs_conversation_same_org']) {
    if (!sql.includes(fragment)) failures.push(`missing tenant-integrity constraint: ${fragment}`);
}
if (!sql.includes('grant all privileges on all tables in schema public to service_role')) {
    failures.push('missing explicit server Data API grants');
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log(`Supabase schema contract OK: ${migrations.length} migrations, ${requiredTables.length} tables, RLS and tenant integrity present.`);
