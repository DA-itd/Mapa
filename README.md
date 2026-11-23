# Mapa Campus ITD — Instituto Tecnológico de Durango

Mapa interactivo del campus del **Instituto Tecnológico de Durango (TecNM)** con edificios, áreas internas (oficinas, aulas y laboratorios), navegación guiada paso a paso, asistente cartográfico con Google Maps Grounding y flujo de contribuciones estudiantiles vía GitHub + Vercel.

## Características principales

- **Mapa interactivo con Google Maps Platform (`@vis.gl/react-google-maps`)**: Marcadores avanzados (`AdvancedMarkerElement`), descubrimiento en vivo de lugares del campus mediante Places API (New) y vista satélite / mapa.
- **Directorio de edificios, aulas, oficinas y laboratorios**: Búsqueda instantánea por código de edificio, nombre de aula, laboratorio u oficina.
- **Navegación guiada paso a paso (`Route.computeRoutes`)**: Trazado de rutas a pie, en bicicleta o auto dentro y alrededor del campus, con instrucciones detalladas paso a paso, enfoque automático en el mapa y lectura por voz opcional.
- **Asistente con Google Maps Grounding (`gemini-4-hydrogen`)**: Consultas en lenguaje natural respaldadas por datos y enlaces verificables de Google Maps.
- **Contribuciones estudiantiles abiertas**: Editor integrado para actualizar edificios, agregar aulas/oficinas/laboratorios, fijar pines en el mapa y exportar `src/data/campus-directory.json` o abrir una propuesta directamente en GitHub.

## Desarrollo local

1. Instala las dependencias:
   ```bash
   npm install
   ```
2. Crea un archivo `.env` basado en `.env.example`:
   ```env
   GEMINI_API_KEY="tu_api_key_de_gemini"
   VITE_GOOGLE_MAPS_API_KEY="tu_api_key_de_google_maps"
   VITE_GITHUB_REPO_URL="https://github.com/tu-usuario/mapa-campus-itd"
   ```
3. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

## Despliegue en Vercel

1. Sube este proyecto a un repositorio público o privado en **GitHub**.
2. Importa el repositorio en **Vercel** (detectará Vite y `vercel.json` automáticamente).
3. En **Project Settings > Environment Variables**, agrega:
   - `VITE_GOOGLE_MAPS_API_KEY` (restringida por referente HTTP a tu dominio `.vercel.app` en Google Cloud Console).
   - `GEMINI_API_KEY` (para el endpoint `/api/maps-grounding`).
   - `VITE_GITHUB_REPO_URL` (URL del repositorio para enlazar las contribuciones de estudiantes).
4. Cada Pull Request fusionado en `main` actualizará automáticamente el mapa en producción.

## Cómo contribuir como estudiante

Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) o usa el botón **Contribuir** dentro de la aplicación para generar tu actualización de `src/data/campus-directory.json`.
