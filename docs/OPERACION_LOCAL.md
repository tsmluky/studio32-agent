# Operación y recuperación · preparación local

Cambios 2026-10-01, sin desplegar. Un solo proceso, JSON operativo con espejo
Supabase. No habilitar varias réplicas usando este volumen como agenda.

## Control y agenda

La lectura fallida/ausente de control Supabase detiene al agente. Se comprueba
antes/después del modelo, herramientas y entrega. Un handoff termina el turno.
takeover cambia a human; resolve no libera; release explícito vuelve a agent.
Una operación ya iniciada antes del takeover puede terminar: no hay rollback.
Las pruebas con dos sesiones usan Auth/BD simulados; no prueban los JWT/RLS reales.

El mutex por tenant cubre comprobación y escritura de reserva dentro de tools.
JSON se escribe con archivo temporal, fsync y rename: un fallo conserva el
anterior; lectura corrupta falla, nunca se interpreta como agenda vacía.
No coordina procesos ni es transacción con Calendar/Supabase. Ese es el trabajo
que resta en S3. No se dispone de PostgreSQL/Docker local para verificarlo aquí.

Calendar configurado sin acceso produce error; no cae a agenda JSON vacía.
Cancelación agente/panel no modifica copia ni confirma éxito si Google rechaza.
Panel sin Calendar cancela también el legacyId JSON. Reconciliación ante fallo
del espejo Supabase y recorrido OAuth real siguen pendientes en A3/A4.

## Recordatorios: opt-in explícito

Por clínica, business.recordatorios.enabled debe ser true y el canal declarado:

```json
{"recordatorios":{"enabled":true,"provider":"whatsapp_meta","phone_number_id":"ID_CONFIGURADO"}}
```

Twilio usa provider=whatsapp_twilio y business.whatsapp_number debe coincidir
con TWILIO_WHATSAPP_NUMBER. Meta exige coincidencia con META_PHONE_NUMBER_ID.
Sin opt-in, demo, borrador, identidad web, teléfono inválido o control humano,
no envía. Nunca selecciona emisor global de otra clínica como fallback.

Respeta timezone del negocio. Solo marca tras enviarMensaje=true; relee última
versión bajo mutex para preservar citas añadidas mientras espera al proveedor.
Un false no marca y puede reintentarse. Aún no hay outbox para distinguir un
timeout de un envío realmente recibido, ni plantillas para la ventana WhatsApp:
no activar recordatorios de producción hasta verificar esos requisitos.

## Snapshot del volumen y ensayo de restauración

Pausar worker/agente y recordatorios o detener proceso antes de copiar. No es
snapshot consistente mientras otro proceso escribe. Destino fuera de DATA_DIR.

```powershell
node scripts/backup-data.cjs create <DATA_DIR> <snapshot-nuevo.json>
node scripts/backup-data.cjs restore <snapshot.json> <directorio-vacio>
```

Límite 100 MB; archivos regulares, JSON válido, rutas relativas y SHA-256.
No sobrescribe snapshot ni restaura sobre directorio con datos. Validación
completa de manifiesto antes de escritura; ensayo automatizado con datos sintéticos.
Elegir una ubicación privada, sin junctions/symlinks, y custodiar el snapshot:
contiene historial/citas en texto recuperable. Permisos POSIX no establecen ACL
Windows; configurar acceso de esa carpeta en el sistema de despliegue.

No incluye Supabase, Calendar ni variables de entorno; requiere procedimientos
independientes. No se generó una copia de datos reales. Tras restaurar verificar
counts, citas, estado humano y reconciliar eventos processing/sending antes de
reactivar. No basta con health=200 para abrir el piloto.
