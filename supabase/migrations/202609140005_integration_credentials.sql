-- Credenciales de integraciones (p. ej. el acceso a Google Calendar de una clínica).
--
-- `integrations` guarda el ESTADO visible de una integración (qué cuenta, qué
-- calendario, si está activa) y la puede leer cualquier miembro de la organización
-- desde el navegador. El acceso en sí —el refresh token de Google— no puede vivir ahí.
-- Va en esta tabla: RLS activado y ninguna política para `anon` ni `authenticated`,
-- así que solo el servidor (service_role) la lee. Además se guarda cifrado con una
-- clave que solo tiene el servidor (INTEGRATION_SECRET_KEY): quien lea la base de
-- datos sin esa clave no obtiene nada utilizable.

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  secret_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create trigger integration_credentials_updated_at before update on public.integration_credentials
  for each row execute procedure public.set_updated_at();

alter table public.integration_credentials enable row level security;

revoke all on public.integration_credentials from anon, authenticated;
grant all privileges on public.integration_credentials to service_role;
