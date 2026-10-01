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

Validación: npm test 62/62; npm run test:supabase 9/9;
npm run check:supabase: 5 migraciones / 15 tablas.
Panel: 10/10 y build verificados en auditoría; no cambiado en esta rama.

## Próximo trabajo y puertas de salida

1. S1: autenticación de webhooks y acceso público /chat; mantener demo/widget.
2. S2/S3: control humano ante fallos y durante generación; concurrencia y
   persistencia durable con recuperación. No vender escalado horizontal todavía.
3. A3/A4: cancelación coherente y Calendar real conectado desde panel.
4. W1/W2/W3: elegibilidad Business/coexistencia, adaptador 360dialog,
   ecos humanos, duplicados, reintentos y notas de voz.
5. O1/O2: alta repetible, recordatorios sin pérdida y recuperación.
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
