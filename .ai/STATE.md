# Estado actual · studio32-agent

> **Se sobrescribe, no se acumula.** Refleja dónde está el repo AHORA.
> Lo histórico va a `DECISIONS.md`. Tope: ~100 líneas.
> Última actualización: **2026-07-21**

## Qué es este repo

Backend del **Studio32 Agent Platform**: agente conversacional multi-tenant que
atiende WhatsApp como recepcionista 24/7 — resuelve dudas con la info real del
negocio, capta leads y gestiona citas en Google Calendar, con handoff a humano.

Es la **fuente canónica del agente**. La copia embebida dentro de `studio32-web`
es legado duplicado: no editarla.

Ecosistema completo: **repo `Studio32` → `notes/CONTEXTO.md`**. No duplicar aquí.

## Dónde corre

- **Railway** · proyecto `thriving-presence` · servicio `web` · Online.
  `https://web-production-d722c.up.railway.app`
- Sirve: webhook de WhatsApp, API del panel, y `widget.js` embebido en
  studio32.es (`data-tenant="studio32"`).
- **No tiene dominio propio**: el panel lo consume por la URL cruda de Railway.
- Datos: Supabase `studio32-agent-platform` · ref `qtmjtgimrzennkoqrslr` · eu-west-1.
- Consumidor: `studio32-panel` → `dashboard.studio32.es` (Cloudflare Pages).

## ⚠️ Aviso de seguridad · sin resolver

`tenants/*/business.json` **está versionado en git** e incluye `owner.token` y
`owner.whatsapp`. Afecta a **10 tenants**, entre ellos `gh-dent`, que lleva datos
reales de la clienta (Gabriela, WhatsApp personal).

El repo es privado, así que el riesgo es medio, no crítico. Pero:
- Los tokens están en el **historial**, no solo en HEAD: ignorarlos ahora no los
  borra retroactivamente.
- **Pendiente de decisión del usuario:** rotar tokens, sacar `tenants/` del repo
  (o solo los campos sensibles), y si merece la pena reescribir historial.
- Mientras tanto: no pegar contenido de esos archivos en chats, issues ni
  capturas, y no hacer público el repo.

## Cliente activo · GH Dent (Clínica Dental, Guadalajara)

Único cliente real en producción. En Supabase solo hay **2 organizaciones**:
`studio32` y `gh-dent` — el resto de carpetas de `tenants/` son demo/QA sin
importar.

**Bloqueadores de go-live:**
1. Verificar el número en **Meta** (tarea principal pendiente).
2. `calendar.calendar_id` está **vacío** → hay que compartir el Google Calendar
   de GH Dent con la service account.
3. El horario de viernes (solo hasta 14:00) puede no estar soportado por
   `checkAvailability` — marcado `[REVISAR]` en su `business.json`.

## Tenants

14 carpetas. Reales/relevantes: `gh-dent` (cliente), `studio32` (propio),
`clinica-cobalto` (**demo comercial**, ver abajo), `barberia_demo` (demo por
defecto). El resto son demo/QA y **no deben importarse a producción**:
`asdasd-lq8h`, `clinica-sonrisa*`, `clinica-sonrisita-stu1`,
`la-taberna-de-ruzafa-o4gb`, `la-terraza-ygad`, `pollo-loco-0w53`, `qa-*`.

Conviene una limpieza de las carpetas basura (`asdasd-lq8h`, `qa-*`) — no urgente.

### `clinica-cobalto` · tenant de demostración

Ficticio, para enseñar el flujo completo del dashboard sin tocar el tenant real
de un cliente. Datos sintéticos (teléfonos `+3460000001x`, sin credenciales
válidas). Se siembra con `supabase/seed-demo-cobalto.sql`: idempotente, acotado
a esa organización y con la agenda **relativa a hoy** para que no caduque.
El acceso se concede a los mismos usuarios que ya entran a `gh-dent`.

## Docs históricos (leer con fecha en la mano)

- `docs/SUPABASE_FOUNDATION.md` — arquitectura, RLS y contrato de control.
  **Sigue vigente y es buena referencia.** Única frase caducada: dice que "Bonto
  debe usar Node 22"; Bonto ya no existe, ahora es Railway.
- `docs/PANEL-MVP-E2E.md` — recorrido E2E validado el 12/07/2026. El **recorrido
  sigue siendo válido**, pero su sección de entorno y pendientes está **caducada**:
  menciona `studio32-agent2.bonto.run` (host muerto) y da por pendiente desplegar
  el panel en Netlify con `panel.studio32.es`. La realidad: backend en Railway y
  panel en Cloudflare Pages bajo `dashboard.studio32.es`.

Son documentos **fechados**: no se corrigen, se superan. El estado vivo es este archivo.

## Git y sincronía entre máquinas

Rama: `main`. Se trabaja desde portátil y sobremesa.

1. **`git pull --rebase` al empezar** una sesión.
2. **Commit + push de `.ai/` al cerrar** una tarea.

## Foco actual

**Preparar la demo comercial** (Juanma la enseña en persona, desde móvil o
portátil). El go-live de GH Dent queda en pausa deliberada: no se involucra a la
clínica todavía, así que sus tres bloqueadores no son el camino crítico ahora.

Hecho en esta tanda:
- Ortografía del conocimiento de `gh-dent` corregida en `tenants/` (**pendiente
  de reimportar a Supabase**: el agente y el panel leen de ahí, no del repo).
- Tenant `clinica-cobalto` creado + seed listo para ejecutar.

Pendiente inmediato:
1. Ejecutar `supabase/seed-demo-cobalto.sql` en el proyecto de Supabase.
2. Propagar la ortografía de `gh-dent` a `agent_configs` (reimportar o SQL).
   Ojo al renombrar servicios con tildes: que la importación **actualice** las
   filas existentes en vez de duplicarlas.
