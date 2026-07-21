# Convenciones · studio32-agent

> Reglas estables del repo. Cambian poco. Si algo aquí deja de ser cierto,
> corrígelo aquí — no lo dupliques en otro archivo.

## Regla de rutas

**Nunca rutas absolutas** (`C:\Users\...`) ni nombres de máquina en `.ai/`,
`CLAUDE.md` ni `AGENTS.md`. Este repo se trabaja desde portátil y sobremesa.
Referencias a otros repos por **nombre de repo + ruta interna**
(`repo Studio32 → notes/CONTEXTO.md`), nunca por ruta de disco.

## Stack

Node **>=22** (obligatorio: el cliente de Supabase lo exige), CommonJS
(`"type": "commonjs"` — `require`, no `import`). Express 4. Sin TypeScript,
sin build.

Dependencias: `@supabase/supabase-js` · `express` · `googleapis` · `openai` ·
`twilio` · `nodemailer` · `dotenv`. **No añadir dependencias sin motivo claro.**

## Arquitectura

```
src/
  server.js          entrada (Procfile / railway.json)
  orchestrator.js    bucle del agente: decide y llama tools
  llm.js · prompt.js · providers/   motor LLM (openai | deepseek | mock)
  tools/             acciones del agente — una por archivo, registradas en index.js
  store/             persistencia — interfaz pública estable (ver abajo)
  channels/          whatsapp.meta.js · whatsapp.twilio.js
  integrations/      googleCalendar.js
  api/               router.js · auth.js — endpoints que consume el panel
  safety.js · check.js · notify.js · reminders.js · onboarding.js
tenants/<slug>/      configuración por negocio (ver abajo)
scripts/             utilidades operativas puntuales
test/                node:test
```

**Regla del store:** las interfaces públicas de `store/*` se mantienen estables;
se cambia la implementación, no la firma. Es lo que evita tocar `tools/` y
`orchestrator.js` en cada migración de persistencia.

**Regla de tools:** una acción por archivo en `src/tools/`, registrada en
`src/tools/index.js`. No meter lógica de negocio en el orchestrator.

## Contrato de control (no romper)

`conversations.control_mode` decide **quién responde**:

- `agent` — el webhook puede invocar al orchestrator y enviar su respuesta.
- `human` — los mensajes entrantes se persisten pero **el agente no responde**.
- `paused` — no debe enviar ni el agente ni el operador hasta reanudar.

Un handoff abre fila en `handoffs` y pone la conversación en `human`. Resolverlo
**no** reactiva el agente: solo una acción explícita de release devuelve a
`agent`. Esto existe para que agente y persona no respondan a la vez. **Cualquier
cambio aquí es un cambio de contrato: requiere aprobación explícita.**

## Multi-tenant

Unidad de aislamiento: `organization_id`. El slug de la carpeta de tenant mapea a
`organizations.slug`. Todo registro operativo pertenece a una organización.

Cada tenant es una carpeta `tenants/<slug>/` con:
`business.json` · `services.json` · `faq.md` · `policies.md` · `tone.md` ·
`handoff.json` (+ `menu.json` en restauración).

La config se autora en estos archivos y se importa **explícitamente**, nunca
escaneando todas las carpetas de QA:

```bash
npm run supabase:import -- studio32 gh-dent
```

El panel es **solo-lectura** sobre esa config.

## Seguridad

- El backend usa un cliente `service_role` dedicado. `anon` no tiene privilegios
  de tabla. **La service-role key nunca llega al navegador**: las acciones del
  panel se reautentican en el backend.
- RLS activo en las 14 tablas. Constraints compuestas impiden enlazar registros
  de organizaciones distintas.
- Secretos por entorno, nunca en el repo. `.env` está ignorado; `.env.example`
  documenta las variables sin valores.
- **`tenants/*/business.json` contiene datos reales de cliente** (ver el aviso de
  `STATE.md`). Tratar como sensible: no pegar su contenido en chats, issues,
  capturas ni documentación.

## Comandos

```bash
npm start                  # node src/server.js
npm run dev                # --watch
npm run check              # comprobación de configuración
npm run chat               # CLI conversacional
npm run test:agent         # smoke
npm run test:supabase      # node --test (adapter + api-auth)
npm run check:supabase     # contrato de esquema (sin Docker ni credenciales)
npm run supabase:import -- <tenant>...
npm run supabase:sync-bookings -- <tenant>
```

Antes de dar por buena una tarea que toque persistencia o API:
`npm run test:supabase && npm run check:supabase`.

## Qué NO hacer

- No romper las firmas públicas de `store/*`.
- No cambiar el contrato de `control_mode` sin aprobación.
- No importar tenants escaneando el directorio entero (hay 13 carpetas y la
  mayoría son demo/QA que **no** deben ir a producción).
- No añadir dependencias ni migrar a ESM/TypeScript sin aprobación.
- No commitear secretos ni credenciales de servicio.
- No editar la copia embebida de este agente que vive dentro de `studio32-web`:
  **la fuente canónica es este repo**.
