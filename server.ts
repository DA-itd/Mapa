import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoogleGenAI} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({limit: '1mb'}));

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.get('/api/maps-config', (_req, res) => {
  const apiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  res.json({apiKey});
});

app.post('/api/maps-grounding', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(500).json({
      error:
        'GEMINI_API_KEY no está configurada en el servidor. Configúrala en Settings > Secrets o en las variables de entorno de Vercel.',
    });
    return;
  }

  const body = req.body as {
    query?: string;
    lat?: number;
    lng?: number;
  };
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) {
    res.status(400).json({error: 'Ingresa una consulta sobre el campus ITD.'});
    return;
  }

  const hasValidCoords =
    typeof body.lat === 'number' &&
    Number.isFinite(body.lat) &&
    typeof body.lng === 'number' &&
    Number.isFinite(body.lng);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Eres el asistente cartográfico del campus del Instituto Tecnológico de Durango (ITD / TecNM Durango), México. Responde en español de forma clara y concisa usando datos reales de Google Maps. Consulta del estudiante: ${query}`,
      config: {
        tools: [{googleMaps: {}}],
        ...(hasValidCoords
          ? {
              toolConfig: {
                retrievalConfig: {
                  latLng: {
                    latitude: body.lat as number,
                    longitude: body.lng as number,
                  },
                },
              },
            }
          : {}),
      },
    });

    const rawChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    const chunks = rawChunks
      .filter((chunk) => Boolean(chunk.maps?.uri || chunk.maps?.title))
      .map((chunk) => ({
        title: chunk.maps?.title ?? 'Ubicación en Google Maps',
        uri: chunk.maps?.uri ?? '',
        placeId: chunk.maps?.placeId ?? '',
        reviewSnippets:
          chunk.maps?.placeAnswerSources?.reviewSnippets
            ?.map((snippet) => ({
              author: snippet.authorAttribution?.displayName ?? '',
              text: snippet.title ?? snippet.review ?? '',
              uri: snippet.googleMapsUri ?? '',
            }))
            .filter((s) => Boolean(s.text || s.uri)) ?? [],
      }));

    res.json({
      text: response.text ?? 'No se encontró información adicional para esa consulta.',
      chunks,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error consultando Google Maps Grounding.';
    console.error('Error en /api/maps-grounding:', err);
    const status = message.includes('429') || message.includes('RESOURCE_EXHAUSTED')
      ? 429
      : 500;
    res.status(status).json({error: message});
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found. Run npm run build.');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Mapa Campus ITD corriendo en http://0.0.0.0:${port}`);
  });
}

startServer();
