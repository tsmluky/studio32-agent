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

## 2026-07-22 · El agente no promete lo que no puede cumplir

Sondeando el agente con conversaciones reales aparecieron cuatro conductas que
en una demo —y en producción— hacen daño:

- Prometía "lo miro y te aviso". **Solo puede responder, no iniciar**, así que
  ese segundo mensaje no llega nunca y la persona se queda esperando.
- Confirmaba mutuas por su nombre sin tenerlas por escrito ("sí, trabajamos con
  Adeslas"). El paciente se presentaría creyendo que tiene cobertura.
- Ofrecía cita en días cerrados.
- Enumeraba los 21 huecos del día, contra su propio tono de "una o dos frases".

**Decisión:** el motor lleva una sección "LO QUE NO PUEDES HACER" con esos
límites explícitos: prohibido prometer mensajes futuros (resolver en el turno o
`handoffHuman`), prohibido confirmar coberturas no escritas —aclarando que un
"trabajamos con la mayoría" en el FAQ NO autoriza a confirmar una concreta—, y
2 o 3 horas concretas al ofrecer hueco. Los días cerrados van marcados en la
lista de próximos días.

**Por qué en el motor y no en cada tenant:** son límites de lo que el sistema
puede hacer, no preferencias de negocio. Un tenant nuevo los hereda sin que
nadie se acuerde de copiarlos.

## 2026-07-22 · El agente lee de `tenants/`, el panel de Supabase

Al corregir el FAQ de Cobalto se vio que cambiar el archivo arreglaba al agente
pero dejaba el panel mostrando el texto viejo: el agente carga la config con
`cargarTenant()` desde `tenants/<slug>/`, mientras que la pestaña "Asistente"
del panel lee `agent_configs` de Supabase.

**Decisión:** al tocar conocimiento de un tenant hay que actualizar **las dos**
capas (archivo + `agent_configs`), o reimportar.

**Por qué importa:** la divergencia es silenciosa. El agente dice una cosa al
paciente y el cliente lee otra en su panel, y nada falla de forma visible.

## 2026-07-25 · El onboarding lo opera Studio32, no es self-service; plantillas por vertical

Al comparar el agente con dos bots a medida (`BOTStudio32`, `peluqueria-bot`) surgió
la duda de cómo adaptar el agente a cada negocio sin picar código por cliente. El
onboarding (`src/onboarding.js` + `public/onboarding.html`) ya lo resolvía —genera la
config del tenant desde un formulario partiendo de una plantilla por vertical— pero
estaba **roto**: faltaba la carpeta `templates/`, así que el desplegable de verticales
salía vacío y `crearTenant` fallaba con "Falta el vertical".

**Decisión:** (1) se recrean las plantillas `templates/{clinica_dental, barberia,
restaurante}` con datos genéricos, sin identidad de ningún cliente real. (2) El
onboarding se reencuadra como **consola de alta interna** que Studio32 rellena CON el
cliente en la reunión, no como un self-service "crea tu agente en 5 minutos": se
cambió la copy (título, botón, textos) para que no parezca un juguete.

**Por qué:** Juanma no quiere que delante del cliente parezca un generador de bots
instantáneo; el valor es un sistema a medida. Que lo rellene Studio32 elimina ese
riesgo sin rehacer nada, porque el agente ya es genérico y lee la config del tenant en
tiempo de ejecución. Las plantillas genéricas evitan que cada clínica nueva arranque
con la identidad (nombre, dirección, mutuas) de gh-dent.

## 2026-07-25 · Limpieza de tenants basura y del proveedor `deepseek`

**Decisión:** se borran los 10 tenants de demo/QA (`asdasd-lq8h`, `clinica-sonrisa*`,
`clinica-sonrisita-stu1`, `la-taberna-de-ruzafa-o4gb`, `la-terraza-ygad`,
`pollo-loco-0w53`, `qa-*`); quedan los 4 vivos: `gh-dent`, `studio32`,
`clinica-cobalto`, `barberia_demo`. Y se elimina el proveedor LLM `deepseek`
(estaba en `config.js`, `llm.js`, `check.js`, `.env.example`, `CONVENTIONS.md`).

**Por qué:** era superficie muerta que confundía. Ninguno de esos tenants estaba en
Supabase, así que borrarlos no afecta a producción. DeepSeek reutilizaba el cliente de
OpenAI y no se usaba; si hiciera falta, se consigue con `LLM_PROVIDER=openai` +
`OPENAI_BASE_URL`, sin variables dedicadas.

## 2026-07-26 · En runtime, Supabase PISA los archivos (riesgo de deriva) [DEUDA]

Corrige y amplía la nota del 2026-07-22 ("el agente lee de `tenants/`"). El
`orchestrator` no solo hace `cargarTenant()` desde archivo: acto seguido llama a
`remote.hydrateTenant()`, que trae `agent_configs` de Supabase y las **fusiona con
prioridad de Supabase** (`mergeRuntimeTenant`: `config?.tone ?? tenant.tone`, etc.).
O sea: si el tenant tiene una config activa en Supabase, **esa gana**; los archivos
son la semilla + el respaldo (si no hay config activa o Supabase falla).

**Consecuencia práctica:** editar los archivos NO cambia producción hasta correr
`npm run supabase:import -- <id>`. Y al revés: un `import` "a ciegas" **pisa** lo que
se haya editado desde el panel (que escribe Supabase). Son dos fuentes de verdad que
pueden divergir en silencio.

**Decisión (por ahora):** mientras el conocimiento se redacta a mano en archivos,
**los archivos son la fuente** y se hace `import` tras cada cambio. NO refactorizar la
carga de config antes del go-live: funciona y es un diseño razonable (BD = config viva
para el panel, archivos = semilla/versionado).

**Pendiente (deuda, no urgente):** cuando el panel sea la superficie de edición, hay
que invertir la fuente de verdad y hacer el `import` consciente — que **avise si la
config de Supabase difiere** de los archivos en vez de sobrescribir sin preguntar.
No perder esto de vista: una sobrescritura silenciosa borraría trabajo del cliente.

## 2026-07-26 · Excepcionalización del contexto: arquetipo por vertical + huella minada

Con Juanma se acota el problema: la parte DURA del agente (motor `prompt.js`) está a
buen nivel; la BLANDA (el "alma": tono, prioridades, inteligencia emocional) sale del
onboarding como campos planos y queda pobre/clónica. Se levanta **conscientemente** la
regla de freeze para atacar esto por ser el diferenciador real.

**Decisión (modelo de dos capas):**
- **Arquetipo** por vertical (lo redacta Studio32, profundo, investigado): el alma del
  oficio, en `templates/<vertical>/`. Reutilizable, es el 90% de la calidad.
- **Huella** por negocio (mínima): lo poco que distingue a ESE cliente. No se saca con
  una entrevista profunda (el dueño no sabe describir su alma) sino **minándola de su
  presencia pública** (web + reseñas) + 2-3 perillas concretas.

**Hecho hoy sobre gh-dent** (patrón oro y cliente piloto), investigando `ghdent.es` y
sus reseñas: reescritos `tone/policies/faq`. Hallazgos que cambiaron el alma — su lema
real es "Vuelve a sonreír, sin miedo" (el miedo es el eje, confirmado por reseñas:
"saben quitar el miedo al dentista"), integralidad ("todo bajo un mismo techo"),
estudio digital 3D, y "explican cada paso" (lo que más repiten los pacientes). El
arquetipo `templates/clinica_dental/` queda como versión genérica con huecos para la
huella.

**Por qué:** dos bots del mismo vertical parecidos NO es problema — cada uno compite
con la competencia local, no entre sí. El arquetipo los hace excepcionales frente a su
competencia real. Siguiente paso previsto: encapsular el flujo (investigar → generar
arquetipo + minar huella) en una **skill**.

## 2026-07-26 · `checkAvailability` soporta horario por día (`franjas_por_dia`)

gh-dent cierra los viernes a las 14:00, pero `checkAvailability` aplicaba una sola lista
de franjas a todos los días laborables (ofrecía huecos de viernes hasta las 18:30, que
no existen). Estaba marcado `[REVISAR]` en su `business.json`.

**Decisión:** el motor acepta `horario.franjas_por_dia` (`{ "5": [{inicio,fin}] }`),
resuelto por día de la semana; si no existe, usa `horario.franjas` para todos. Cambio
**aditivo**: los tenants sin ese campo se comportan igual. gh-dent: viernes 10:00–14:00.

**Por qué:** ofrecer un hueco inexistente es un fallo de cara al paciente (se presenta y
no le atienden). El horario partido por día es común (mañanas de sábado, viernes corto).

## 2026-07-26 · El agente puede admitir que es un asistente virtual si se lo preguntan

La regla inviolable decía "nunca hables de que eres una IA" y el filtro `safety.js`
bloqueaba "soy una IA". Combinado con dar al agente un nombre humano, empujaba a mentir.

**Decisión:** (1) no se personifica con nombre humano (gh-dent vuelve a `agente_nombre`
"GH Dent"); el nombre real es decisión de la clínica. (2) Si preguntan directamente si es
un bot o una persona, el agente lo admite con naturalidad como "asistente virtual del
negocio". Se relaja `safety.js` para no bloquear eso; se sigue bloqueando filtrar el
proveedor/modelo (OpenAI, GPT).

**Por qué:** hacerse pasar por humano es un riesgo de honestidad y de marca, y una
mentira detectable destruye la confianza. Admitir que es un asistente virtual no resta
calidez y es lo correcto.
