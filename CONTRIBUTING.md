# Guía para Contribuciones Estudiantiles — Mapa Campus ITD

¡Gracias por ayudar a mantener actualizado el mapa del Instituto Tecnológico de Durango! Los estudiantes, docentes y personal pueden proponer nuevos edificios, corregir nombres de oficinas, añadir aulas o actualizar horarios de laboratorios.

## Opción 1: Usar el Editor Integrado en la Web

1. Abre la aplicación y haz clic en **Contribuir** en la barra superior (o **Editar áreas** dentro de cualquier edificio).
2. Selecciona un edificio existente o crea uno nuevo.
3. Si necesitas fijar su ubicación exacta en el campus, haz clic en **Fijar pin en el mapa** y toca el punto exacto sobre el mapa de Google Maps.
4. Agrega o modifica las **oficinas, aulas o laboratorios** (código, nombre, tipo, piso, horario).
5. Ve a la pestaña **Enviar a GitHub**, copia o descarga el archivo `campus-directory.json` generado y abre un Pull Request o Issue en el repositorio.

## Opción 2: Editar directamente en GitHub

1. Haz un **Fork** de este repositorio.
2. Edita el archivo `src/data/campus-directory.json`.
3. Respeta la estructura de cada edificio:
   - `id`: identificador único en minúsculas y guiones (ej. `itd-edificio-sistemas`)
   - `code`: clave corta (ej. `CC`, `EDIF-A`)
   - `name`: nombre oficial o común del edificio
   - `category`: `"Académico" | "Laboratorios" | "Administrativo" | "Biblioteca e Información" | "Deporte y Cultura" | "Servicios Estudiantiles"`
   - `spaces`: arreglo con objetos `{ id, code, name, kind, floor, schedule?, notes? }`
4. Verifica que el JSON sea válido (`npm run build`) y envía tu **Pull Request** describiendo qué áreas actualizaste.
