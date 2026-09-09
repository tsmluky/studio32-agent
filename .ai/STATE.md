# Estado actual · studio32-agent

> **Se sobrescribe, no se acumula.** Refleja dónde está el repo AHORA.
> Lo histórico va a `DECISIONS.md`. Tope: ~100 líneas.
> Última actualización: **2026-09-09**

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

## Seguridad de los tenants · resuelto el 2026-09-09 (queda un fleco)

El repo es **público** desde el 25/08. Lo que se hizo:

- `tenants/*` ya no se versiona. Solo se re-incluyen a mano los ficticios, que
  tienen que viajar porque Railway los lee del repo y sin ellos se cae la demo de
  studio32.es. `gh-dent` salió del control de versiones el 08/09 (sigue en disco).
- Los `owner.token` de `studio32` y `barberia_demo` están **rotados**, y los nuevos
  salen del entorno: `OWNER_TOKEN_<TENANT>`. El archivo solo manda en los tenants
  del volumen, que nunca se versionan. Sin variable y sin archivo, no hay modo
  dueño — fallo seguro. `npm run check` dice de dónde sale el de cada uno.

**Lo que sigue abierto:**
- Los valores viejos siguen en el historial. Ya no abren nada, pero ahí están.
  Reescribir el historial es una decisión sin tomar.
- El `owner.whatsapp` de gh-dent (número personal de la clienta) está en el
  historial y **eso no se rota**. Si se decide limpiar, es por aquí por donde hay
  que empezar.
- ~~En Supabase quedaban copias del token viejo dentro de `agent_configs.business`~~
  → vaciadas el 09/09.

## Persistencia · volumen montado (2026-07-27)

`web-volume` montado en **`/app/data`**. Antes NO existía y el contenedor es efímero:
cada despliegue borraba `data/<tenant>/bookings.json`, que es la fuente OPERATIVA de
las citas (getAgenda, cancel/reschedule, dedup y —sin Calendar— disponibilidad).
Verificado E2E: reservar → desplegar → sobrevive → cancelar → hueco libre.
Ver `DECISIONS.md` 2026-07-27.

## Clientes · ninguno (2026-09-09)

**GH Dent ya no existe como cliente.** Se les envió el presupuesto y nunca
respondieron. No tratarlo como cliente activo ni perseguir ese hilo: sus dos
bloqueadores dejaron de ser bloqueadores porque no hay nadie esperando al otro lado.
Su tenant sigue en disco, fuera del control de versiones.

En Supabase siguen las 3 organizaciones: `studio32`, `gh-dent` y `clinica-cobalto`
(demo, sembrada por SQL). El resto de tenants no están importados.

Lo de abajo se conserva porque **es la lista de lo que hará falta con el primer
cliente que entre**, sea quien sea. Ahora mismo el orden de trabajo lo manda el repo
`Studio32` → `notes/CAMINO.md`.

**Lo que hará falta para cualquier go-live:**
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

## Tenants · 6 versionados

`studio32` (propio), `clinica-cobalto` (demo comercial, ver abajo), `barberia_demo`,
`restaurante-demo`, `servicios-demo` y `estetica-demo`. Los cinco de demostración
tienen que seguir versionados: Railway los lee del repo y sin ellos se cae la demo en
vivo de studio32.es. `gh-dent` sigue en disco pero fuera del control de versiones.

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
Railway), hoy `clinica-cobalto`: WhatsApp y dashboard van coordinados.

Estuvo apuntando a `gh-dent` hasta el 09/09, y al sacar ese tenant del repo dejó de
existir en el contenedor: **cualquier mensaje al sandbox reventaba**, en silencio y
solo en producción. Ya no puede repetirse —`tenantPorDefecto()` cae en un tenant de
demostración y avisa por consola— pero la lección es que esa variable apunte siempre a
algo versionado.

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

## Foco actual (2026-09-09)

**Que el producto aguante.** El plan entero vive en el repo `Studio32` →
`notes/CAMINO.md`. Lo que ya está hecho en este repo:

- **`npm run test:agent`** existe de verdad (`scripts/smoke.js`): habla con el agente
  como un cliente y comprueba EFECTOS —que la cita esté en la agenda—, no frases.
  Siete casos, verde en local y contra Railway (`test:agent:prod`). Con `SMOKE_TOKEN`
  no gasta el cupo de la demo.
- **`npm run eval`**: quince casos de criterio contra `clinica-cobalto` (no contra
  `gh-dent`, que ya no está versionado). Estable en tres pasadas seguidas.
- **`npm test`**: 26 pruebas unitarias, incluidas las del guard de confirmación y las
  de identidad de citas.
- **`/health`**: dice si está vivo, con qué modelo corre, cuántos tenants ve y si el
  volumen se puede escribir. Sin secretos.
- **Guard de confirmación** (`src/confirmacion.js`): el agente no puede dar por hecha
  una cita que no existe, ni decir una hora distinta de la guardada.

**Lo que el smoke encontró el primer día** (todo arreglado, ver DECISIONS 2026-09-09):
confirmaba citas inexistentes, el dedup de reservas no miraba la sesión en las demos,
y cualquiera podía cancelar la cita de otro dando su teléfono por chat.

- **Vigilancia**: `npm run vigilar` + `.github/workflows/vigilancia.yml`, cada media
  hora. Comprueba que está vivo con el volumen montado y que contesta sin rendirse; si
  falla, GitHub manda un correo. Sin secretos ni infraestructura nueva. Un 429 no
  cuenta como caída (es la demo protegiéndose); un 200 con "se me ha cruzado algo"
  dentro, sí.
- **Aguante ante fallos de fuera**: el modelo tiene 30 s de espera y dos reintentos
  (la librería traía diez minutos por defecto), y los caminos que antes morían en
  silencio —respuesta vacía, bucle de herramientas— dejan marca en el log.

**Con esto, el carril 1 del camino está entero.** Lo siguiente ya no es este repo: es
el kit de visita (huella unificada, manual, precio).

Sigue en pie el modelo de **arquetipo por vertical + huella minada del negocio** (ver
DECISIONS 2026-07-26) como diferenciador. Lo nuevo es que la huella tiene que ser una
sola: hoy la prospección y `montar-demo` investigan el mismo negocio por separado.

Este archivo está por encima de su tope de ~100 líneas y arrastra registros de julio
que ya son historia. Toca podarlo.

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
