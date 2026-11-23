import {GoogleGenAI} from '@google/genai';

interface VercelRequest {
  method?: string;
  body?: {
    query?: string;
    lat?: number;
    lng?: number;
  };
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Método no permitido'});
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'GEMINI_API_KEY no está configurada en Vercel Environment Variables.',
    });
    return;
  }

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({error: 'Ingresa una consulta sobre el campus ITD.'});
    return;
  }

  const hasValidCoords =
    typeof req.body?.lat === 'number' &&
    Number.isFinite(req.body.lat) &&
    typeof req.body?.lng === 'number' &&
    Number.isFinite(req.body.lng);

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

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
                    latitude: req.body?.lat as number,
                    longitude: req.body?.lng as number,
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

    res.status(200).json({
      text: response.text ?? 'No se encontró información adicional.',
      chunks,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error consultando Google Maps Grounding.';
    const status = message.includes('429') || message.includes('RESOURCE_EXHAUSTED')
      ? 429
      : 500;
    res.status(status).json({error: message});
  }
}
