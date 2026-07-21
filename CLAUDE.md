# studio32-agent

El contexto de este repo vive en `.ai/`. **Este archivo es solo un puntero — no
añadas contenido aquí**, o volverá a divergir de su gemelo.

## Antes de tocar nada

1. `.ai/STATE.md` — dónde está el proyecto ahora, dónde corre, bloqueadores.
   Incluye un **aviso de seguridad sin resolver**: léelo.
2. `.ai/CONVENTIONS.md` — stack, arquitectura, contrato de control, comandos.
3. `.ai/DECISIONS.md` — solo si necesitas saber **por qué** algo es como es.

Contexto del ecosistema completo: repo `Studio32` → `notes/CONTEXTO.md`.

## Al terminar una tarea

- Reescribe `.ai/STATE.md` si el estado cambió (**sobrescribir, no acumular**).
- Añade a `.ai/DECISIONS.md` toda decisión no obvia, con su porqué.
- Commit y push de `.ai/` — es lo que sincroniza portátil y sobremesa.

## Reglas que no se rompen

- **Rutas relativas siempre.** Nada de `C:\Users\...` ni nombres de máquina.
- `git pull --rebase` al empezar, push al terminar. Dos máquinas trabajan este
  repo y `STATE.md` entra en conflicto si te lo saltas.
- No romper el contrato `control_mode` ni las firmas públicas de `store/*`.
- Si algo de `.ai/` ya no es cierto, **corrígelo**. Doc obsoleta es peor que nada.
