# Estado actual · studio32-agent

Actualizado: 2026-10-01. Fuente canónica del agente; no editar la copia
embebida en studio32-web. Histórico en DECISIONS.md.

## Objetivo actual

Preparar el SaaS existente para una clínica piloto, con alta asistida,
WhatsApp por coexistencia y agenda fiable. Plan: docs/PILOTO.md.
Tareas y dependencias: docs/roadmap-piloto.json.
Rama de trabajo: fix/preparacion-piloto-clinicas; cambios locales no desplegados.

## Producto y despliegue observado

- Backend Node >=22 / Express / CommonJS, tools y store modulares.
- Railway: web-production-d722c.up.railway.app; health respondió 200 en la auditoría.
  No se verificó la revisión desplegada ni el sistema de archivos remoto.
- Volumen anunciado por health: /app/data. JSON sigue siendo OPERATIVO en citas;
  Supabase no reemplaza todavía todas las lecturas/escrituras de JSON.
- Panel existente: studio32-panel → dashboard.studio32.es (Cloudflare Pages).
  Login, organizaciones, inbox, agenda, servicios y takeover/release tienen código.
- Supabase compartido con Hub: studio32-hub / wwhinwxedcvpxprmcsta.
  El borrado del proyecto anterior está documentado en DECISIONS.md.

## Evidencia de base de datos · lectura 2026-10-01

- 2 organizaciones, 13 citas de demo, 14 conversaciones, 116 mensajes, 8 servicios.
- 1 miembro y 1 configuración del agente; 0 channel_accounts;
  0 integration_credentials y 0 integraciones Google activas.
- 15 tablas con RLS y 9 constraints de organización validadas.
- Falta probar aislamiento con dos usuarios autenticados.
- anon tiene grants de lectura en appointments; RLS restringe las políticas
  observadas a authenticated. Grants por sí solos no prueban exposición.
- No hay evidencia de una clínica real operando el recorrido completo.

## Correcciones de esta rama

- Fecha/hora estrictas; horario por día compartido por consulta, alta y cambio.
- Alta rechaza servicios inactivos/desconocidos y profesionales desconocidos.
- Catálogo Supabase vacío no vuelve a activar el catálogo de archivo.
- Si mover en Google falla, no cambia la copia ni se devuelve éxito.
- Guard: cancelación no se confunde con alta; agenda inaccesible produce
  una respuesta sin confirmación de cita.
- Roadmap HTML reproducible desde JSON y flujo Archify con criterios por tarea.
- S1: firmas Meta/Twilio obligatorias, separación web/teléfono, autorización
  de chat de clínica, alta interna cerrada y routing exacto/único. 12 pruebas HTTP.

- S2: control fail-closed y guards durante modelo/herramientas/entrega;
  handoff termina turno. API con dos sesiones y permisos simulados comprobados.
- S3 local: mutex por tenant (un proceso), JSON atómico, corrupción falla.
  Snapshot/restauración sintética verificados. Docs: OPERACION_LOCAL.md.
- A3: rechazo Calendar no cambia copia; panel sin Calendar cancela legacy JSON.
  Calendar configurado inaccesible no cae a agenda vacía.
- O2: recordatorios opt-in por emisor, timezone y flag tras aceptación;
  preserva escrituras concurrentes. Plantillas/outbox siguen pendientes.
- W2: conector 360dialog por clínica, inbox persistente, ecos humanos,
  duplicados, queued recuperable y envíos inciertos para revisión; ruta panel.
  Desactivado, sin cuenta ni número elegible. Docs: 360DIALOG_LOCAL.md.

Validación: npm test 116/116; npm run test:supabase 26/26;
npm run check:supabase: 5 migraciones / 15 tablas.
Panel: 10/10 y build verificados en auditoría; no cambiado en esta rama.

## Próximo trabajo y puertas de salida

1. S1 local: configurar secretos/URL y comprobar proveedor antes de desplegar.
2. S2/S3: dos JWT/RLS reales, fuente transaccional y backup Supabase separado.
   Mutex solo local: no vender escalado horizontal todavía.
3. A3/A4: reconciliación ante caída del espejo y Calendar real desde panel.
4. W1/W2/W3: sin cuenta 360dialog; código/pruebas locales autorizados.
   Cerrar outbox/estados panel, retención y latencia; después notas de voz.
5. O1/O2: alta repetible, plantillas, alertas y recuperación operativa.
6. P1/P2: piloto limitado y medir utilidad, incidencias, soporte y costes.

Ningún hito H1–H5 está cerrado. Llamadas automáticas y cobro/alta autoservicio
quedan después. Precio pendiente: 300 alta / 150 mensual es hipótesis del fundador.

## Configuración y seguridad pendientes

- OAuth Google: comprobar cliente, redirect, publicación/permisos y reconexión.
  Testing con público externo caduca refresh tokens a los 7 días: no usar así
  con una clínica real. Cero credenciales DB no excluye cuenta de servicio global.
- Rotar INTEGRATION_SECRET_KEY antes de conectar primer cliente real;
  misma clave en todos los runtimes que descifran esa base.
- Secretos en entorno, nunca panel/repo. business.json contiene datos sensibles.
- Historial público: datos personales de antiguo tenant y tokens históricos
  rotados; limpieza de historial pendiente de decisión.
- GH Dent no es cliente activo; no convertir datos demo en tracción comercial.

## Contratos y trabajo entre máquinas

- Preservar firmas store/* y control_mode (agent/human/paused).
- Resolver handoff no libera agente; release explícito.
- git pull --rebase al comenzar; commit/push al cerrar en la rama de trabajo.
- Validar API/persistencia con test:supabase y check:supabase.
- No aplicar migraciones ni desplegar automáticamente esta preparación.
- Docs históricos SUPABASE_FOUNDATION y PANEL-MVP-E2E deben leerse con fecha.
- Ecosistema: repo Studio32 → notes/CONTEXTO.md y CAMINO.md.
