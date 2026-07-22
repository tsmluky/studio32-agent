-- Seed del tenant de DEMOSTRACIÓN "Clínica Cobalto".
--
-- Para qué: dejar el dashboard con datos creíbles para enseñar el flujo completo
-- en una demo comercial, SIN tocar el tenant real de un cliente (gh-dent).
--
-- Propiedades:
--   · Idempotente: se puede reejecutar; limpia y regenera solo este tenant.
--   · Acotado: cada sentencia filtra por la organización 'clinica-cobalto'.
--     Ninguna toca otras organizaciones.
--   · Fechas relativas a hoy (Europe/Madrid), para que la agenda no caduque.
--
-- USO COMO RESET ANTES DE UNA DEMO: reejecutarlo hace las dos cosas que hacen
-- falta tras un ensayo. Borra el rastro de las pruebas (conversaciones y citas
-- que haya creado el agente) y, como las fechas son relativas, recoloca la
-- agenda alrededor del día en que se lanza. Ensaya lo que quieras y ejecútalo
-- justo antes de presentar.
--
-- Fuente de la configuración: tenants/clinica-cobalto/ en este repo.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Organización
-- ─────────────────────────────────────────────────────────────
insert into public.organizations (slug, name, status, timezone, locale, metadata)
values (
  'clinica-cobalto',
  'Clínica Cobalto · Clínica Dental',
  'active',
  'Europe/Madrid',
  'es-ES',
  jsonb_build_object('demo', true, 'purpose', 'Tenant ficticio para demostraciones comerciales')
)
on conflict (slug) do update
  set name = excluded.name,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 2. Acceso: quien ya entra a gh-dent entra también al demo
-- ─────────────────────────────────────────────────────────────
insert into public.organization_members (organization_id, user_id, role)
select demo.id, m.user_id, 'owner'
from public.organizations demo
join public.organizations gh on gh.slug = 'gh-dent'
join public.organization_members m on m.organization_id = gh.id
where demo.slug = 'clinica-cobalto'
on conflict (organization_id, user_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3. Limpieza idempotente (SOLO de este tenant demo)
-- ─────────────────────────────────────────────────────────────
delete from public.appointments  where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');
delete from public.messages      where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');
delete from public.handoffs      where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');
delete from public.leads         where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');
delete from public.conversations where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');
delete from public.contacts      where organization_id = (select id from public.organizations where slug = 'clinica-cobalto');

-- ─────────────────────────────────────────────────────────────
-- 4. Catálogo de servicios
-- ─────────────────────────────────────────────────────────────
insert into public.services (organization_id, external_key, name, description, duration_minutes, price_amount, currency, active)
select o.id, v.key, v.name, v.descr, v.dur, v.price, 'EUR', true
from public.organizations o,
(values
  ('primera-visita',       'Primera visita (gratuita)', 'Revisión inicial con presupuesto cerrado y sin compromiso.', 30, 0::numeric),
  ('higiene-dental',       'Higiene dental',            'Limpieza profesional completa. Incluye revisión de encías.',  40, 45::numeric),
  ('revision-general',     'Revisión general',          'Revisión periódica de control.',                              30, null::numeric),
  ('ortodoncia-invisible', 'Ortodoncia invisible',      'Estudio y seguimiento de alineadores transparentes.',         45, null::numeric),
  ('implantes',            'Implantes',                 'Valoración y colocación de implantes dentales.',              60, null::numeric),
  ('blanqueamiento',       'Blanqueamiento',            'Blanqueamiento profesional con valoración previa.',           45, 279::numeric),
  ('endodoncia',           'Endodoncia',                'Tratamiento de conductos.',                                   60, null::numeric),
  ('odontopediatria',      'Odontopediatría',           'Atención dental infantil.',                                   30, null::numeric)
) as v(key, name, descr, dur, price)
where o.slug = 'clinica-cobalto'
on conflict (organization_id, external_key) do update
  set name = excluded.name,
      description = excluded.description,
      duration_minutes = excluded.duration_minutes,
      price_amount = excluded.price_amount,
      active = true,
      updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 5. Pacientes (ficticios, teléfonos sintéticos)
-- ─────────────────────────────────────────────────────────────
insert into public.contacts (organization_id, phone, email, name, status, source, first_seen_at, last_seen_at)
select o.id, v.phone, v.email, v.name, v.status, 'whatsapp',
       now() - (v.seen_days || ' days')::interval,
       now() - (v.seen_hours || ' hours')::interval
from public.organizations o,
(values
  ('+34600000011', 'marta.garcia@example.com',  'Marta García',    'customer', 40, 2),
  ('+34600000012', 'david.lopez@example.com',   'David López',     'lead',      6, 1),
  ('+34600000013', 'ana.perez@example.com',     'Ana Pérez',       'customer', 90, 5),
  ('+34600000014', 'javier.ruiz@example.com',   'Javier Ruiz',     'customer', 25, 26),
  ('+34600000015', 'carmen.ortega@example.com', 'Carmen Ortega',   'lead',      3, 30),
  ('+34600000016', 'lucia.fernandez@example.com','Lucía Fernández','customer', 60, 50)
) as v(phone, email, name, status, seen_days, seen_hours)
where o.slug = 'clinica-cobalto';

-- ─────────────────────────────────────────────────────────────
-- 6. Conversaciones (una por estado, para enseñar el control humano)
-- ─────────────────────────────────────────────────────────────
insert into public.conversations (organization_id, contact_id, status, control_mode, subject, last_message_at)
select o.id, c.id, v.status, v.mode, v.subject, now() - (v.mins || ' minutes')::interval
from public.organizations o
join public.contacts c on c.organization_id = o.id
join (values
  ('Marta García',    'open',     'agent', 'Higiene dental',    12),
  ('David López',     'open',     'human', 'Primera visita',    48),
  ('Ana Pérez',       'open',     'agent', 'Cambio de cita',   140),
  ('Carmen Ortega',   'resolved', 'agent', 'Precio ortodoncia', 610)
) as v(name, status, mode, subject, mins) on v.name = c.name
where o.slug = 'clinica-cobalto';

-- ─────────────────────────────────────────────────────────────
-- 7. Mensajes
-- ─────────────────────────────────────────────────────────────
insert into public.messages (organization_id, conversation_id, direction, sender_type, body, occurred_at, status)
select o.id, cv.id, v.direction, v.sender, v.body, cv.last_message_at - (v.ago || ' minutes')::interval, 'delivered'
from public.organizations o
join public.contacts c on c.organization_id = o.id
join public.conversations cv on cv.contact_id = c.id and cv.organization_id = o.id
join (values
  ('Marta García', 'inbound',  'contact', 'Hola, ¿hacéis limpiezas dentales? ¿Qué precio tienen?', 6),
  ('Marta García', 'outbound', 'agent',   'Sí, hacemos higiene dental. La sesión completa son 45 € y dura unos 40 minutos. ¿Quieres que busque un hueco?', 5),
  ('Marta García', 'inbound',  'contact', '¿Podría ir el jueves por la tarde?', 3),
  ('Marta García', 'outbound', 'agent',   'El jueves tengo hueco a las 16:30 y a las 18:00. ¿Cuál te viene mejor?', 2),
  ('Marta García', 'inbound',  'contact', 'A las 18:00. Soy Marta García.', 1),
  ('Marta García', 'outbound', 'agent',   'Hecho, Marta: higiene dental el jueves a las 18:00. Si necesitas cambiarla, escríbeme por aquí a cualquier hora.', 0),
  ('David López',  'inbound',  'contact', 'Buenas, llevo tiempo sin ir al dentista y me da bastante respeto. ¿La primera visita es gratis?', 8),
  ('David López',  'outbound', 'agent',   'Sí, la primera visita es gratuita y sin compromiso. Tranquilo, es solo una revisión para ver cómo está todo y darte un presupuesto cerrado.', 6),
  ('David López',  'inbound',  'contact', 'Vale. ¿Puedo llevar un informe de otra clínica para que lo miréis?', 3),
  ('David López',  'outbound', 'human',   'Claro que sí, David. Tráelo y lo revisamos contigo en la visita. Te escribo desde recepción para ayudarte a cuadrar el día.', 0),
  ('Ana Pérez',    'inbound',  'contact', 'Hola, tengo cita el viernes pero me ha surgido un imprevisto. ¿Puedo cambiarla?', 4),
  ('Ana Pérez',    'outbound', 'agent',   'Sin problema, Ana. La del viernes queda cancelada. ¿Te viene bien la semana que viene por la mañana?', 2),
  ('Ana Pérez',    'inbound',  'contact', 'Sí, el martes a primera hora me va perfecto.', 0),
  ('Carmen Ortega','inbound',  'contact', '¿Cuánto cuesta la ortodoncia invisible?', 5),
  ('Carmen Ortega','outbound', 'agent',   'Depende de cada caso, por eso hacemos primero un estudio. La primera visita es gratuita y de ahí sale un presupuesto cerrado. Además tenemos financiación hasta 36 meses sin intereses.', 3),
  ('Carmen Ortega','inbound',  'contact', 'Perfecto, me lo pienso y os escribo. ¡Gracias!', 0)
) as v(name, direction, sender, body, ago) on v.name = c.name
where o.slug = 'clinica-cobalto';

-- ─────────────────────────────────────────────────────────────
-- 8. Agenda (relativa a hoy, Europe/Madrid)
-- ─────────────────────────────────────────────────────────────
insert into public.appointments (organization_id, contact_id, service_id, status, starts_at, ends_at, resource_name, notes)
select
  o.id,
  c.id,
  s.id,
  v.status,
  ((date_trunc('day', (now() at time zone 'Europe/Madrid')) + (v.day_offset || ' days')::interval + v.at) at time zone 'Europe/Madrid'),
  ((date_trunc('day', (now() at time zone 'Europe/Madrid')) + (v.day_offset || ' days')::interval + v.at + (s.duration_minutes || ' minutes')::interval) at time zone 'Europe/Madrid'),
  'Equipo Cobalto',
  v.notes
from public.organizations o
join public.contacts c on c.organization_id = o.id
join public.services s on s.organization_id = o.id
join (values
  -- hoy
  ('Javier Ruiz',     'higiene-dental',       'completed',  0, interval '10 hours',                  'Revisión de encías. Buena evolución.'),
  ('Marta García',    'higiene-dental',       'confirmed',  0, interval '12 hours 30 minutes',       'Primera higiene con nosotros.'),
  ('Lucía Fernández', 'revision-general',     'confirmed',  0, interval '17 hours 30 minutes',       'Control anual.'),
  -- mañana
  ('David López',     'primera-visita',       'confirmed',  1, interval '9 hours 30 minutes',        'Viene con miedo al dentista; trae informe de otra clínica.'),
  ('Ana Pérez',       'ortodoncia-invisible', 'confirmed',  1, interval '11 hours',                  'Seguimiento de alineadores.'),
  ('Carmen Ortega',   'primera-visita',       'pending',    1, interval '16 hours',                  'Interesada en ortodoncia invisible. Pendiente de confirmar.'),
  -- pasado mañana
  ('Javier Ruiz',     'blanqueamiento',       'confirmed',  2, interval '10 hours',                  'Blanqueamiento tras la higiene.'),
  ('Lucía Fernández', 'endodoncia',           'confirmed',  2, interval '18 hours',                  'Molestias en molar inferior derecho.'),
  -- resto de la semana
  ('Marta García',    'revision-general',     'confirmed',  3, interval '12 hours',                  'Control posterior a la higiene.'),
  ('Ana Pérez',       'odontopediatria',      'cancelled',  3, interval '13 hours',                  'Cancelada por el paciente; se reagenda.'),
  ('David López',     'implantes',            'pending',    4, interval '9 hours 30 minutes',        'Valoración de implante. Pendiente de presupuesto.'),
  -- histórico
  ('Ana Pérez',       'higiene-dental',       'completed', -7, interval '11 hours',                  'Higiene semestral.'),
  ('Lucía Fernández', 'primera-visita',       'completed', -21, interval '16 hours 30 minutes',      'Primera visita. Alta en la clínica.')
) as v(name, svc, status, day_offset, at, notes)
  on v.name = c.name and v.svc = s.external_key
where o.slug = 'clinica-cobalto';

-- ─────────────────────────────────────────────────────────────
-- 9. Configuración del asistente (espejo de tenants/clinica-cobalto/)
-- ─────────────────────────────────────────────────────────────
insert into public.agent_configs (organization_id, version, status, business, services_snapshot, faq, policies, tone, handoff_config, activated_at)
select
  o.id, 1, 'active',
  jsonb_build_object(
    'nombre', 'Clínica Cobalto · Clínica Dental',
    'ciudad', 'Valencia',
    'horario_texto', 'Lunes a viernes de 09:30 a 20:00. Sábados y domingos, cerrado.'
  ),
  coalesce((
    select jsonb_agg(jsonb_build_object('nombre', s.name, 'duracion_min', s.duration_minutes, 'precio_eur', s.price_amount) order by s.name)
    from public.services s where s.organization_id = o.id
  ), '[]'::jsonb),
  $faq$- ¿La primera visita es gratuita? Sí, la primera visita incluye revisión y presupuesto cerrado, sin compromiso.
- ¿Cuánto cuesta una higiene dental? La higiene completa son 45 € y dura unos 40 minutos.
- ¿Es doloroso el tratamiento? No debe doler. Trabajamos con técnicas actuales y un protocolo cuidadoso, sobre todo si vienes con miedo o llevas tiempo sin venir.
- ¿Trabajáis con seguros o mutuas? Sí, con la mayoría. Dinos tu póliza y te confirmamos coberturas sin compromiso.
- ¿Ofrecéis financiación? Sí, hasta 36 meses sin intereses.
- ¿Dónde estáis y qué horario tenéis? En el centro de Valencia. Lunes a viernes de 09:30 a 20:00. Sábados y domingos, cerrado.
- ¿Qué tratamientos hacéis? Revisiones, higiene, ortodoncia invisible, implantes, blanqueamiento, endodoncia y odontopediatría.
- ¿Cómo pido cita? Por aquí mismo te ayudo a agendar, dime qué necesitas y qué día te viene bien.$faq$,
  $pol$- PRIMERA VISITA: es gratuita y sin compromiso; ofrécela como primer paso siempre que encaje.
- PRECIOS: solo das cerrados los del catálogo (higiene 45 €, blanqueamiento 279 €). El resto depende de cada caso.
- SALUD: nunca des diagnósticos ni consejo médico concreto.
- HONESTIDAD: no inventes tratamientos, resultados, plazos ni coberturas.
- PRIVACIDAD: cada conversación es privada; no menciones a otros pacientes.$pol$,
  $tone$Eres parte del equipo de Clínica Cobalto, una clínica dental en Valencia. Atiendes por WhatsApp a pacientes y personas interesadas. Hablas en español de España, con tildes.

Eres alguien de recepción: cercano, tranquilo y profesional. Mensajes cortos, de chat, sin emojis ni markdown. Transmite calma: muchos pacientes vienen con miedo al dentista.

Tu prioridad es tranquilizar y ayudar a agendar. La primera visita es gratuita y sin compromiso: es el paso fácil que puedes ofrecer casi siempre.$tone$,
  jsonb_build_object('email', 'info@studio32.es'),
  now()
from public.organizations o
where o.slug = 'clinica-cobalto'
on conflict (organization_id, version) do update
  set faq = excluded.faq,
      policies = excluded.policies,
      tone = excluded.tone,
      business = excluded.business,
      services_snapshot = excluded.services_snapshot,
      status = 'active',
      updated_at = now();

commit;

-- Comprobación
select
  (select count(*) from public.contacts      c join public.organizations o on o.id = c.organization_id where o.slug = 'clinica-cobalto') as contactos,
  (select count(*) from public.conversations c join public.organizations o on o.id = c.organization_id where o.slug = 'clinica-cobalto') as conversaciones,
  (select count(*) from public.messages      m join public.organizations o on o.id = m.organization_id where o.slug = 'clinica-cobalto') as mensajes,
  (select count(*) from public.services      s join public.organizations o on o.id = s.organization_id where o.slug = 'clinica-cobalto') as servicios,
  (select count(*) from public.appointments  a join public.organizations o on o.id = a.organization_id where o.slug = 'clinica-cobalto') as citas;
