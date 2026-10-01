# Camino al primer piloto de clínica

Actualizado: 2026-10-01. Fuente de tareas: `docs/roadmap-piloto.json`.

## Objetivo

Una clínica opera durante 14 días con su WhatsApp habitual, recepción humana y
una agenda fiable. Medimos utilidad y carga de soporte antes de ampliar clientes.
Los 14 días y los umbrales siguientes son una propuesta de validación, no un
compromiso comercial ya acordado con una clínica.

## Método de trabajo

Hitos con criterios de aceptación y un tablero de tareas con dependencias.
Solo una tarea de implementación activa cada vez. Se pueden investigar proveedores
y preparar pruebas en paralelo. La matriz Harada queda como inspiración opcional;
no añadimos 64 tareas para rellenar una cuadrícula.

Estados: existente (hay código), pendiente, local (corregido con pruebas),
externo (requiere cuenta/configuración), después. Local no significa desplegado.
No calculamos un porcentaje de SaaS terminado contando archivos o pruebas.

## Hitos de salida

1. **H1 Seguridad y datos:** entradas autenticadas, aislamiento entre clínicas,
   control humano seguro, persistencia recuperable y reserva concurrente segura.
2. **H2 Agenda:** consultar, crear, mover y cancelar contra una agenda real;
   sin confirmar éxito ante un fallo; coincidencia con el panel.
3. **H3 WhatsApp:** coexistencia demostrada en una cuenta elegible; texto, audio,
   duplicados, ecos de mensajes humanos y reintentos funcionan sin dobles respuestas.
4. **H4 Operación:** alta asistida repetible, configurar servicios, tomar/liberar
   conversación, alertas y procedimiento de recuperación probado.
5. **H5 Piloto:** clínica de prueba, expectativas y duración pactadas, resultados
   revisados con recepción. No abrir otro piloto hasta evaluar el primero.

H3 puede investigarse mientras se corrigen H1/H2. Ninguno de esos hitos está cerrado.

## Evidencia actual

- Backend modular, API y panel existentes; panel: 10 pruebas y build pasaron en
  la auditoría previa de esta sesión. Falta probar el panel con una clínica operando.
- Supabase verificado en lectura: 2 organizaciones; 13 citas de demostración,
  0 cuentas de canal y 0 credenciales de integración. No demuestra producción E2E.
- Citas e identidad operativa aún dependen de JSON en el volumen, además del espejo
  Supabase. Tener contenedores no garantiza concurrencia ni aislamiento entre réplicas.
- Correcciones de esta rama: reglas de fecha/hora/horario por día compartidas;
  no reservar servicios inactivos o profesionales inventados; no resucitar el
  catálogo del archivo; un fallo de mover en Calendar no modifica la copia;
  el guard no confunde una cancelación con una reserva y falla sin confirmar.
- S1 implementado: firmas obligatorias Meta/Twilio, chat de clínica autorizado,
  identidad web separada, alta interna cerrada, rutas sin traversal y números
  exactos/únicos; sandbox explícito solo demo. 12 regresiones HTTP sin servicios externos.
- Validación local: `npm test` 74/74; `npm run test:supabase` 9/9;
  `npm run check:supabase` contrato de 5 migraciones / 15 tablas.
- Pendientes importantes: configuración y validación real de webhooks, control humano ante
  fallos, concurrencia, cancelación ante fallo de Google, recordatorios y reconciliación.

## Producto y límites del piloto

SaaS de clínica con alta asistida; aprovechamos `dashboard.studio32.es` y el agente.
WhatsApp y notas de voz primero. Llamadas ordinarias atendidas por recepción.
Voz telefónica automatizada, cobro automático y alta autoservicio quedan después.
Si una agenda del cliente no se puede integrar, el agente recoge solicitudes y
recepción confirma; no se vende reserva autónoma en ese caso.

Precio pendiente. 300 EUR de alta / 150 EUR mensuales es la hipótesis del fundador;
requiere calcular canal, modelo, soporte e integración antes de ofertarlo.
Prueba gratuita acotada con una clínica: duración, volumen y salida por escrito;
no ofrecer servicio gratuito indefinido.

## Medición y decisión propuestas

Registrar solicitudes, tareas resueltas, confirmaciones efectivas en la agenda,
intervenciones humanas, tiempo de soporte y coste variable por clínica.
Objetivo de observación: 30 conversaciones reales; si no llegan en 14 días,
no afirmar utilidad estadística y decidir una extensión limitada con la clínica.
Condiciones para continuar: cero accesos entre clínicas, cero citas fantasma o
duplicados atribuibles al agente, recepción entiende takeover/release y reconoce
ahorro de trabajo en una revisión semanal. Estos umbrales deben pactarse en el piloto.
Ante incidente de agenda, pausar reservas automáticas y pasar a solicitudes humanas.

## Cómo mantener el roadmap

Cada tarea incluye estado, dependencias, criterio y evidencia. Para cerrarla se
actualizan código y pruebas, luego el JSON, este documento y el HTML generado.
Las notas del navegador son personales y no cambian el estado técnico del proyecto.
El siguiente trabajo es S2: controlar la respuesta durante takeover y fallos,
y probar aislamiento con dos usuarios. S1 está verificado localmente, pendiente
de configurar secretos y validar el proveedor en despliegue; ver `docs/SEGURIDAD_ENTRADAS.md`.
El flujo editable está en `docs/roadmap-flujo.archify.json`. Generación:

```text
node <archify>/bin/archify.mjs finalize workflow docs/roadmap-flujo.archify.json outputs/flujo-studio32.html --quality showcase --json
node scripts/render-roadmap.cjs outputs/flujo-studio32.html outputs/roadmap-studio32.html
```

Usar el ejecutable Chromium disponible en ARCHIFY_CHROME para la prueba real
del navegador. El JSON de tareas permite regenerar el tablero sin editar HTML.

No aplicar migraciones ni desplegar esta rama sin revisar el cambio concreto y
la configuración requerida. Mantener demos y widget de Studio32 operativos.
