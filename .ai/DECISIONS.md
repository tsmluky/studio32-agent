# Decisiones · studio32-agent

> **Append-only.** Se añade abajo, nunca se reescribe ni se borra.
> Nadie lee este archivo entero: se consulta. Formato: fecha · decisión · por qué.
> Si una decisión se revierte, **no la borres** — añade una nueva que la anule.

---

## 2026-07-11 · Supabase como capa de datos compartida

Migración documentada en `docs/SUPABASE_FOUNDATION.md`.

**Decisión:** Supabase (`studio32-agent-platform`) es la capa de datos compartida
por el agente y el panel. Unidad de aislamiento: `organization_id`. RLS en las 14
tablas, 27 políticas, 4 constraints de integridad multi-tenant.

**Por qué:** el panel necesitaba leer los mismos datos que escribe el agente sin
hablar con los proveedores de canal ni recibir la service-role key.

## 2026-07-11 · Contrato de control agente/humano

**Decisión:** `conversations.control_mode` ∈ {`agent`, `human`, `paused`} es la
autoridad sobre quién responde. Un handoff pone `human`; resolverlo **no**
reactiva el agente — hace falta una acción explícita de release.

**Por qué:** evitar que el agente y una persona respondan a la vez al cliente.
Es un fallo visible para el cliente final y destruye la confianza en el producto.

## 2026-07-11 · Interfaces de `store/` estables

**Decisión:** la fase 2 sustituye implementaciones de `store/*` manteniendo las
firmas públicas.

**Por qué:** limita el cambio a la capa de persistencia sin tocar `tools/` ni el
orchestrator. La migración JSON→Supabase se pudo hacer sin reescribir el agente.

## 2026-07-11 · Importación explícita de tenants

**Decisión:** los tenants se importan por nombre
(`npm run supabase:import -- studio32 gh-dent`), nunca escaneando el directorio.

**Por qué:** hay 13 carpetas y la mayoría son demo/QA. Un escaneo automático
metería basura en la base de producción.

## 2026-07-21 · Contexto compartido en `.ai/`, sincronizado por git

**Decisión:** el contexto del repo vive en `.ai/` (`STATE`, `DECISIONS`,
`CONVENTIONS`) como fuente única; `CLAUDE.md` y `AGENTS.md` son punteros.
Prohibidas las rutas absolutas: referencias por nombre de repo + ruta interna.

**Por qué:** el usuario alterna Claude Code y la app desktop de ChatGPT, desde
portátil y sobremesa. Al vivir en el repo, GitHub sincroniza el contexto gratis.
Antecedente: en `studio32-web` la doc se pudrió apuntando a rutas del sobremesa
(usuario `lukys`) que no sobrevivieron a la migración.

## 2026-07-21 · Los docs fechados no se corrigen, se superan

`docs/PANEL-MVP-E2E.md` describe el backend en `studio32-agent2.bonto.run`, host
que ya no existe (ahora Railway), y da por pendiente un despliegue del panel en
Netlify que finalmente fue a Cloudflare Pages.

**Decisión:** los documentos con fecha se dejan intactos como registro histórico.
El estado vivo es `.ai/STATE.md`, que señala qué partes están caducadas.

**Por qué:** reescribir un documento fechado destruye la trazabilidad de cuándo
se validó qué. Y mantener dos fuentes "vivas" es exactamente lo que provocó la
divergencia en `studio32-web`.

## 2026-07-21 · La ortografía del conocimiento es parte del producto

Todo el conocimiento de `gh-dent` (`faq`, `tone`, `policies`, `services`) estaba
escrito sin tildes ni signos de apertura. `tone.md` llegaba a pedir "Hablas en
espanol de Espana, con tildes" sin una sola tilde, y decía "mas de 20 anos".

**Decisión:** el conocimiento del tenant se escribe con ortografía correcta y se
trata como texto de cara al cliente, no como configuración interna.

**Por qué:** se lee en dos sitios que importan. El cliente lo ve en la pestaña
"Asistente" del panel, y sobre todo es el prompt del sistema: un prompt sin
acentos empuja al modelo a responder igual a los pacientes. No es cosmético.

## 2026-07-21 · Tenant `clinica-cobalto` para demos, en vez de sembrar en gh-dent

Para preparar una demo comercial hacía falta un dashboard con datos creíbles
(agenda poblada, conversaciones en varios estados). El tenant real de gh-dent
solo tenía ruido de pruebas: citas duplicadas, canceladas de QA y un "paciente"
llamado Pancho.

**Decisión:** se crea un tenant ficticio `clinica-cobalto` con su carpeta en
`tenants/` y un seed acotado (`supabase/seed-demo-cobalto.sql`). El tenant real
no se toca.

**Por qué:** sembrar pacientes inventados en el tenant que será la producción de
la clínica los dejaría indistinguibles de citas reales el día del go-live. El
nombre reutiliza la "Clínica Cobalto" que ya aparece como demo en studio32.es,
para no inventar otra marca. El seed es idempotente y filtra por la organización
demo en cada sentencia.

## 2026-07-22 · La fecha se le da resuelta al modelo, no calculada

Probando el flujo de reserva se pidió cita "el viernes por la mañana" y el
agente contestó "el viernes 22 de julio" —fecha que se contradice, porque el 22
era miércoles— y guardó la cita ese mismo día en vez del viernes.

El prompt ya inyectaba la fecha de hoy y el modelo la sabía: preguntado a
bocajarro respondía "miércoles, 22 de julio". Lo que falla es la aritmética.

**Decisión:** el prompt lista los próximos 7 días ya resueltos (día de la semana
+ DD/MM/YYYY) y pide buscar en la lista en vez de calcular. Además la fecha se
deriva en la zona del negocio, no en la del proceso.

**Por qué:** una reserva mal fechada es de los peores fallos posibles aquí —
llega al calendario del cliente y nadie lo detecta hasta que el paciente no
aparece. Fiarlo a que el modelo cuente días es innecesario cuando el servidor
puede resolverlo. Lo de la zona horaria importa porque el servidor corre en UTC:
entre medianoche y las 02:00 de España un `new Date()` pelado da el día anterior,
justo en la franja nocturna que este agente existe para cubrir.
