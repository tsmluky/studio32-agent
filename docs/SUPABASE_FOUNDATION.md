# Supabase foundation

## Decision

Supabase is the shared data layer for the agent and the future independent Studio32 panel. The current JSON store remains operational until Phase 2 switches each repository adapter; this migration does not change production behavior by itself.

Hosted project:

- Name: `studio32-agent-platform`
- Project ref: `qtmjtgimrzennkoqrslr`
- Region: `eu-west-1`
- URL: `https://qtmjtgimrzennkoqrslr.supabase.co`
- Schema applied and verified: 11 July 2026

The unit of isolation is `organization_id`. A Studio32 client is an organization, the current tenant folder slug maps to `organizations.slug`, and every operational record belongs to that organization.

## Phase 1 deliverable

The initial migration provides:

- Supabase Auth profiles and organization memberships with `owner`, `admin`, `operator` and `viewer` roles.
- Channel-neutral contacts, conversations and messages for web, Meta WhatsApp, Twilio WhatsApp and later voice.
- Services, appointments and external Calendar identifiers.
- Leads and handoffs matching the tools already implemented by the agent.
- Versioned agent configuration snapshots matching the current tenant files.
- Integrations and immutable-style audit events for the dashboard.
- Row Level Security on every exposed table.
- Composite foreign keys that prevent records from different organizations being linked together.

No demo organization is seeded. Real users must be created through Auth and attached to an organization deliberately.

Hosted verification result after applying both migrations:

| Check | Result |
| --- | ---: |
| Public tables | 14 |
| Tables with RLS | 14 |
| Critical tenant-integrity constraints | 4 |
| RLS policies | 27 |

The backend uses a dedicated `service_role` client. Its Data API privileges are
granted explicitly by migration `202607110003`; no table privileges are granted
to `anon`.

## Control contract

`conversations.control_mode` is the authority for who can respond:

- `agent`: the webhook may invoke the orchestrator and send its response.
- `human`: inbound messages are persisted but the agent does not respond.
- `paused`: neither automated nor normal operator sending should proceed until explicitly resumed.

A handoff creates an open `handoffs` row and changes the conversation to `human`. Resolving it does not silently reactivate the agent; the explicit release action changes `control_mode` back to `agent`. This avoids the agent and a person answering at the same time.

## Phase 2 adapter map

| Current module | Supabase target |
| --- | --- |
| `store/conversations.js` | `contacts`, `conversations`, `messages` |
| `store/bookings.js` | `appointments` plus Google Calendar external ID |
| `store/leads.js` | `contacts`, `leads` |
| `store/logs.js` | `handoffs`, `audit_logs` |
| `store/usage.js` | derived message/conversation queries; later aggregate view |
| `tenants/<id>/*` | `organizations`, `services`, versioned `agent_configs` |

Phase 2 should keep the public store interfaces stable while replacing their implementations. That limits changes in tools and the orchestrator.

## Phase 2 implementation status

The agent now loads `@supabase/supabase-js` only when both server variables are
present. During the transition it reads from Supabase first and keeps a JSON
mirror for rollback and for the legacy panel.

Connected stores:

- conversations, contacts and message timeline;
- leads;
- handoffs, conversation control mode and audit events;
- inbound usage metrics;
- appointment create, cancel and reschedule mirrors while Calendar remains an integration.
- persistent webhook idempotency using Twilio `MessageSid` and Meta message IDs.

Tenant knowledge is imported explicitly, never by scanning every QA folder:

```bash
npm run supabase:import -- studio32 gh-dent
```

Activation requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the trusted
backend environment. Without both variables, all existing JSON behavior remains
unchanged.

## Endpoints reserved for Phase 3

The database contract supports these backend endpoints without redesigning the schema:

- `GET /api/inbox?organization_id=...`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/takeover`
- `POST /api/conversations/:id/release`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/resolve`

These endpoints belong in `studio32-agent`. The future `studio32-panel` consumes them and Supabase Auth; it does not connect to channel providers directly.

## Apply and verify

Link this repository to the intended Supabase project and apply the migrations with the Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
npm run check:supabase
```

For a disposable local environment, use `supabase start` followed by `supabase db reset`. The static contract check can run without Docker or Supabase credentials.
