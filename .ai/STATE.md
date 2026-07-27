# Estado actual · studio32-agent

> **Se sobrescribe, no se acumula.** Refleja dónde está el repo AHORA.
> Lo histórico va a `DECISIONS.md`. Tope: ~100 líneas.
> Última actualización: **2026-07-25**

## Qué es este repo

Backend del **Studio32 Agent Platform**: agente conversacional multi-tenant que
atiende WhatsApp como recepcionista 24/7 — resuelve dudas con la info real del
negocio, capta leads y gestiona citas en Google Calendar, con handoff a humano.

Es la **fuente canónica del agente**. La copia embebida dentro de `studio32-web`
(`studio32-web/studio32-agent/`) es legado duplicado: no editarla. Pendiente de
decidir si se borra del todo (ver Exceso, abajo).

Ecosistema completo: **repo `Studio32` → `notes/CONTEXTO.md`**. No duplicar aquí.

## Dónde corre

- **Railway** · proyecto `thriving-presence` · servicio `web` · Online.
  `https://web-production-d722c.up.railway.app`
- Sirve: webhook de WhatsApp, API del panel, `widget.js` embebido en studio32.es
  (`data-tenant="studio32"`) y el onboarding (`/onboarding`).
- **No tiene dominio propio**: el panel lo consume por la URL cruda de Railway.
- Datos: Supabase `studio32-agent-platform` · ref `qtmjtgimrzennkoqrslr` · eu-west-1.
- Consumidor: `studio32-panel` → `dashboard.studio32.es` (Cloudflare Pages).

## ⚠️ Aviso de seguridad · sin resolver

`tenants/*/business.json` **está versionado en git** e incluye `owner.token` y
`owner.whatsapp`. `gh-dent` lleva datos reales de la clienta (Gabriela, WhatsApp
personal). El repo es privado, así que el riesgo es medio, no crítico. Pero:
- Los tokens están en el **historial**, no solo en HEAD. Borrar tenants (como se
  hizo el 2026-07-25) los quita de HEAD pero **no** del historial.
- **Pendiente de decisión del usuario:** rotar tokens, sacar `tenants/` del repo
  (o solo los campos sensibles), y si merece la pena reescribir historial.
- Mientras tanto: no pegar contenido de esos archivos en chats, issues ni
  capturas, y no hacer público el repo.

## Persistencia · volumen montado (2026-07-27)

`web-volume` montado en **`/app/data`**. Antes NO existía y el contenedor es efímero:
cada despliegue borraba `data/<tenant>/bookings.json`, que es la fuente OPERATIVA de
las citas (getAgenda, cancel/reschedule, dedup y —sin Calendar— disponibilidad).
Verificado E2E: reservar → desplegar → sobrevive → cancelar → hueco libre.
Ver `DECISIONS.md` 2026-07-27.

## Cliente activo · GH Dent (Clínica Dental, Guadalajara)

Único cliente real en producción. En Supabase hay 3 organizaciones: `studio32`,
`gh-dent` y `clinica-cobalto` (demo, sembrada por SQL). El resto de tenants no
están importados.

**Bloqueadores de go-live (entrega prevista: primera semana de agosto):**
1. Verificar el número en **Meta** (tarea principal pendiente; plazo incierto,
   empezar cuanto antes).
2. **Google Calendar sin configurar del todo**: no hay service account creada
   (`GOOGLE_CREDENTIALS_JSON` no existe en Railway) NI `calendar.calendar_id`.
   Plan acordado: el calendario lo crea Studio32 desde `soporte.studio32@gmail.com`
   (uno por cliente) y se invita a los correos de la clínica → menos fricción.
   **Antes de montarlo hay que confirmar dónde lleva GH Dent su agenda hoy**: el
   agente consulta UN solo calendario, así que las citas por teléfono tienen que
   caer ahí o habrá doble reserva.
3. ~~Horario de viernes~~ → resuelto (`franjas_por_dia`).
4. `handoff.json` apunta a `soporte.studio32@gmail.com` (pruebas) → restaurar
   `gabriela@ghdent.es` al go-live.

## Tenants · 4 (limpieza hecha el 2026-07-25)

Solo quedan los vivos: `gh-dent` (cliente), `studio32` (propio), `clinica-cobalto`
(demo comercial, ver abajo) y `barberia_demo` (demo por defecto / `DEFAULT_TENANT`
del webchat). Los 10 de demo/QA se borraron (ver `DECISIONS.md` 2026-07-25).

### `clinica-cobalto` · tenant de demostración

Ficticio, para enseñar el flujo completo del dashboard sin tocar el tenant real de
un cliente. Datos sintéticos (teléfonos `+3460000001x`, sin credenciales válidas).
Se siembra con `supabase/seed-demo-cobalto.sql`: idempotente, acotado a esa
organización y con la agenda **relativa a hoy** para que no caduque.

**Reset antes de la demo:** reejecutar el seed borra el rastro de los ensayos y
recoloca la agenda en el día en que se lanza. Ensayar libremente y ejecutarlo justo
antes de presentar.

**WhatsApp de la demo:** el sandbox de Twilio (`+14155238886`) no coincide con el
`whatsapp_number` de ningún tenant, así que cae en `DEFAULT_TENANT` (variable de
Railway). Apuntándola a `clinica-cobalto`, WhatsApp y dashboard van coordinados.
**Valor original: `gh-dent`** — devolverlo ahí al retomar su go-live.

## Onboarding · funcional (arreglado el 2026-07-25)

`/onboarding` genera un tenant borrador desde un formulario, partiendo de una
plantilla por vertical en `templates/{clinica_dental, barberia, restaurante}`.
Faltaba esa carpeta y estaba roto; se recreó con datos genéricos. Reencuadrado como
**consola de alta interna** (la rellena Studio32 con el cliente), no self-service.
El formulario es ahora un **wizard de 6 pasos** (negocio, horario, servicios,
conocimiento, integraciones, revisión) con la **piel del hub** (DM Sans/Manrope,
verde, sidebar). El backend guarda además políticas propias y `calendar_id`.
El borrador aún se activa a mano: `npm run supabase:import -- <id>` + cablear canal.

**Entrada desde el hub (cableada, pendiente de desplegar):** en `studio32-hub`
(`src/App.tsx`) se añadió un ítem "Alta de asistente" en el sidebar que abre el
onboarding (`ONBOARDING_URL`, por defecto la URL de Railway; override
`VITE_ONBOARDING_URL`). Falta `npm install && npm run build:static` en el hub y
desplegar `static-dist` → `studio32-hub-live`. El hub no tenía `node_modules`, así
que el build/typecheck no se pudo verificar en esta sesión.

## Exceso pendiente de limpiar (no urgente)

- **Copia embebida del agente** en `studio32-web/studio32-agent/`: decidir si se
  borra (antes confirmar que ese repo no la despliega).
- `DEFAULT_TENANT` con dos fallbacks distintos: los canales caen a `studio32`, el
  webchat/config a `barberia_demo`. Deberían coincidir.

## Docs históricos (leer con fecha en la mano)

- `docs/SUPABASE_FOUNDATION.md` — arquitectura, RLS y contrato de control. Vigente.
- `docs/PANEL-MVP-E2E.md` — recorrido E2E válido, pero su sección de entorno está
  caducada (menciona hosts muertos). Son documentos **fechados**: no se corrigen,
  se superan. El estado vivo es este archivo.

## Git y sincronía entre máquinas

Rama: `main`. Se trabaja desde portátil y sobremesa.
1. **`git pull --rebase` al empezar** una sesión.
2. **Commit + push de `.ai/` (y del resto) al cerrar** una tarea.

## Foco actual

**Excepcionalización del contexto (freeze levantado a propósito).** Se decidió que
la calidad de las "partes blandas" del agente es el diferenciador y se ataca ya, aun
con el go-live de GH Dent en pausa. Modelo: **arquetipo por vertical + huella minada
del negocio** (ver DECISIONS 2026-07-26). Los tres bloqueadores de go-live (Meta,
Calendar, viernes) siguen sin ser camino crítico; el del viernes ya está resuelto en
código (`franjas_por_dia`).

Cerrado el 2026-07-26:
- gh-dent: `tone/policies/faq` reescritos desde investigación real de `ghdent.es` +
  reseñas (eje "sin miedo"). `agente_nombre` vuelto a "GH Dent" (sin nombre humano).
- `templates/clinica_dental/` ascendido a arquetipo genérico.
- `checkAvailability`: soporte de horario por día (`franjas_por_dia`); viernes gh-dent
  10:00–14:00. Aditivo, probado offline.
- `prompt.js` + `safety.js`: el agente puede admitir que es asistente virtual si se lo
  preguntan (antes se le empujaba a mentir).
- **Desplegado y verificado en vivo (2026-07-26):** el agente corre en Railway
  proyecto `thriving-presence` → servicio `web` (autodeploy desde el repo, dominio
  `web-production-d722c.up.railway.app`). Hecho: `supabase:import -- gh-dent` (config
  activa v1 con el alma nueva) + Railway `DEFAULT_TENANT` cambiado `clinica-cobalto`→
  `gh-dent` (la demo de Twilio ahora cae en gh-dent). Probado por `/chat`: reconoce el
  miedo, deriva a la valoración gratuita sin dar precios, y el viernes solo ofrece
  mañanas (10:00–14:00). El agente NO está en `studio32-hub-agent` (ese es un bot de
  Telegram distinto).
- **Guarda de fecha añadida:** el modelo resolvía "este viernes" a un viernes ya pasado.
  El prompt ahora prohíbe fechas anteriores a mañana y fuerza el próximo día de la lista.
- **Avisos por email FUNCIONANDO (Resend).** Railway bloquea el SMTP saliente
  (timeout en 465 y 587; desde fuera conectan) → `notify.js` envía por la API HTTPS
  de Resend cuando hay `RESEND_API_KEY` (variable en Railway). Dominio `studio32.es`
  verificado en Resend (cuenta del usuario); remitente `SMTP_FROM` = Citas Studio32
  <citas@studio32.es>. DNS en **Cloudflare** (no Hostinger): añadidos TXT
  `resend._domainkey` (DKIM) + MX/TXT `send` (SPF). NO se añadió el MX de recepción:
  el correo entrante sigue en Hostinger (buzón `info@`, 8 alias, plan 1/1 lleno).
  Probado E2E: reserva → email "Delivered" a soporte.studio32@gmail.com.
- **createBooking endurecido:** rechaza placeholders ("Cliente"/"CLIENTE_NO_ESPECIFICADO"
  creaba citas fantasma que bloqueaban el hueco); el contacto debe parecer tel/email.
- **handoff gh-dent en fase de pruebas:** avisos → soporte.studio32@gmail.com.
  Al go-live: restaurar gabriela@ghdent.es (+ whatsapp), ver nota en handoff.json.
- Siguiente paso previsto: encapsular investigar→arquetipo+huella en una **skill**.

Cerrado el 2026-07-25:
- Onboarding arreglado y reencuadrado; plantillas por vertical recreadas.
- Limpieza de tenants (14 → 4) y eliminación del proveedor `deepseek`.
