---
name: montar-demo
description: Convierte la web de un negocio en un tenant de demostración listo para enseñar en persona. Úsala cuando haya que preparar la visita a un negocio concreto (estética, dental, restaurante, barbería, servicio local) y se necesite su agente funcionando con sus datos reales. Triggers - "monta la demo de X", "prepara el tenant de X", "voy a visitar X", "demo para X".
---

# Montar la demo de un negocio

Prepara un tenant de demostración a partir de la web pública de un negocio, para
enseñárselo **a ese negocio** en persona. No es un cliente: es un prospecto que
todavía no sabe que existes.

## Qué se produce

`tenants/<slug>/` con seis archivos, listo para que el dueño escriba y le conteste:

| Archivo | De dónde sale |
|---|---|
| `business.json` | Huella del negocio (nombre, ciudad, horarios, profesionales) |
| `services.json` | Huella del negocio (servicios y precios) |
| `handoff.json` | Fijo: siempre a Studio32, nunca al negocio |
| `tone.md` | Arquetipo de la vertical, con los nombres cambiados |
| `policies.md` | Arquetipo de la vertical, con precios y cierres del negocio |
| `faq.md` | Arquetipo + las preguntas propias que tenga su web |

`tenants/` está ignorado por git a propósito: son datos de terceros que nunca se
versionan.

## Pasos

**1. Sacar la huella.** Si no existe ya en `herramientas/huellas/<dominio>.md`:

```
cd herramientas && ./crawl4ai-venv/Scripts/python huella.py https://elnegocio.es
```

**2. Elegir el arquetipo de vertical.** Copia `tone.md`, `policies.md` y `faq.md` del
tenant de demostración más cercano y adapta solo lo que cambia:

| Vertical del negocio | Arquetipo a copiar |
|---|---|
| Centro de estética | `estetica-demo` |
| Clínica dental | `clinica-cobalto` |
| Restaurante | `restaurante-demo` |
| Barbería / peluquería | `barberia_demo` |
| Servicio a domicilio | `servicios-demo` |

Lo que se cambia del arquetipo: nombre del negocio y del agente, nombres de las
profesionales, precios que sí estén en su catálogo, días de cierre y cualquier norma
propia que diga su web. **El criterio del oficio no se toca** — es lo que se vende.

**3. Rellenar los JSON desde la huella**, con las reglas de abajo.

**4. Probar antes de salir de casa.** Levanta el agente y escríbele tú tres cosas: una
consulta sin nombre de tratamiento, una pregunta de precio, y una cita pidiendo a una
profesional concreta. Si algo suena raro, se arregla ahora, no delante del dueño.

## Reglas que no se rompen

**Precios: `null` salvo cifra explícita en su web.** Nunca deduzcas, nunca un rango,
nunca "suele rondar". Con `null` el agente responde que depende y ofrece la valoración
— que es exactamente la conducta que le estás vendiendo. Un precio inventado delante
del dueño, sobre su propio negocio, te deja sin credibilidad en un segundo.

**Horarios: solo lo que esté escrito.** Si su web no los publica claros, deja
`horario_texto` conservador y no rellenes `franjas_por_dia` a ojo.

**Profesionales: solo nombres que estén publicados** en su página de equipo, y solo el
nombre de pila. Nada de apellidos, ni de redes sociales, ni de datos que no haya
puesto el propio negocio en su web.

**Siempre `"demo": true`.** Activa agenda por sesión y límites de uso: la demo no toca
ningún calendario real y no se puede abusar de ella.

**Credenciales de prueba, nunca reales.** `owner.token` de demo y `whatsapp_number` de
pruebas. El `handoff.json` apunta **siempre a Studio32** — no tienes permiso para
enrutar avisos al correo del negocio.

**Anota la fuente de cada dato.** En `business.json`, campo `_fuentes`: de qué URL
salieron los precios, los horarios y el equipo. Cuando el dueño pregunte "¿de dónde has
sacado eso?", la respuesta es "de vuestra página de tratamientos", y eso impresiona.
Sugerir que sabes más de lo que has mirado, incomoda.

## Al terminar

Resume en pantalla, para poder defenderlo en persona:

- Qué se rellenó y de qué URL salió cada bloque
- **Qué quedó en `null` y por qué** — es lo primero que hay que saber antes de entrar
- Qué no se encontró en su web (si no hay equipo publicado, no hay profesionales)
- El comando para levantar el agente con ese tenant

## Cómo se enseña (contexto de por qué existe esto)

En el local: le pasas **tu móvil** con WhatsApp ya unido al sandbox de Twilio y le dices
"escríbele lo que te escribiría una clienta". Teclea él. Luego le enseñas dónde cayó la
cita en el panel. Y le dejas la landing personalizada, que funciona en su móvil sin que
tenga que unirse a nada, para que la mire luego y se la enseñe a su socio.

Nunca le enseñes `studio32.es`: teniéndolo delante, enseñarle tu marketing en vez de su
negocio funcionando es ir hacia atrás.
