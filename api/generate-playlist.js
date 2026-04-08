function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function uniqueSongs(songs) {
  const seen = new Set();
  const out = [];

  for (const song of songs || []) {
    const title = String(song?.title || '').trim();
    const artist = String(song?.artist || '').trim();
    const genre = String(song?.genre || '').trim();

    if (!title || !artist) continue;

    const key = `${title.toLowerCase()}__${artist.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({
      title,
      artist,
      genre: genre || 'unknown'
    });
  }

  return out;
}

function extractJsonCandidate(text) {
  const cleanText = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleanText.slice(firstBrace, lastBrace + 1);
  }

  return cleanText;
}

function buildPrompt({
  perfil,
  contexto,
  climaTexto,
  cancionesRecientes,
  artistasRecientes,
  usedSongs,
  usedArtists,
  batchSize,
  includeMeta
}) {
  return `
Eres un curador musical experto en identidad sonora para negocios.
Tu trabajo NO es hacer una playlist genérica de streaming.
Tu trabajo es hacer una selección editorial, distintiva, elegante, actual y poco obvia.

NEGOCIO:
- Nombre: ${perfil.nombre || ''}
- Tipo: ${perfil.tipo || ''}
- Subtipo: ${perfil.subtipo || ''}
- Ciudad: ${perfil.ciudad || ''}
- Edad cliente: ${perfil.edad || ''}
- Género predominante cliente: ${perfil.gcliente || ''}
- Descripción del cliente: ${perfil.cdesc || ''}
- Cliente ideal: ${perfil.cideal || ''}
- Vibe: ${perfil.vibe || ''}
- Referencias: ${perfil.refs || ''}
- Permanencia: ${perfil.permanencia || ''}
- Ruido: ${perfil.ruido || ''}
- Dinámica: ${perfil.dinamica || ''}
- Estética: ${perfil.estetica || ''}
- No quiere: ${perfil.nowant || ''}
- Horario operación: ${perfil.horarioop || ''}

CONTEXTO DEL MOMENTO:
- Horario actual de uso: ${contexto.horario || ''}
- Objetivo musical: ${contexto.mood || ''}
- Duración solicitada: ${contexto.dur || 4} horas
- Canciones requeridas totales: ${contexto.songCount || 60}
- Canciones a generar en este lote: ${batchSize}
- ${climaTexto}
- Necesidad editorial: la selección debe sentirse viva, actual y con criterio, no vieja ni genérica.

REGLAS EDITORIALES OBLIGATORIAS:
1. Evita música demasiado comercial, demasiado obvia, demasiado viral o demasiado gastada.
2. No hagas una playlist de “grandes éxitos”.
3. No suenes a playlist genérica de cafetería, hotel, tienda o algoritmo.
4. Prioriza criterio editorial, descubrimiento, profundidad y buen gusto.
5. La playlist DEBE sentirse actual y viva: incluye parte del repertorio reciente cuando encaje.
6. Incluye canciones de este año y del año pasado cuando realmente encajen con el lugar y el mood.
7. No hagas que la playlist suene dominada por canciones viejas o nostálgicas.
8. No hagas que la playlist suene dominada por pura novedad o puro hit reciente.
9. Mezcla épocas, países e idiomas cuando tenga sentido.
10. Usa una mezcla rica de géneros si encajan con el negocio: jazz, soul, pop, hip hop, r&b, funk, disco, house, electrónica, ambient, indie, bossa, afro, latin, downtempo, trip hop, neo-soul, world, etc.
11. NO fuerces un solo género. La mezcla debe depender de la dinámica y características del lugar.
12. Si el lugar pide elegancia, profundidad o sofisticación, apóyate más en jazz, soul, neo-soul, downtempo, house fino, electrónica orgánica, ambient, disco refinado, bossa, funk, world y pop selecto.
13. Si el lugar pide energía, sí puedes usar pop, hip hop, funk, disco, house, afro, latin, electrónica o indie más activos, pero sin volverlo una lista mainstream.
14. No repitas artistas innecesariamente.
15. Si dudas entre una canción famosa y una mejor curada, elige la mejor curada.
16. NO inventes canciones ni artistas.
17. Devuelve únicamente canciones reales y plausibles.
18. Da prioridad a canciones que probablemente existan en Spotify.
19. Evita estas canciones recientes del historial:
${cancionesRecientes.length ? cancionesRecientes.map(s => `- ${s}`).join('\n') : '- Ninguna'}
20. Evita estos artistas recientes del historial:
${artistasRecientes.length ? artistasRecientes.map(a => `- ${a}`).join('\n') : '- Ninguno'}
21. NO repitas estas canciones ya generadas en lotes anteriores:
${usedSongs.length ? usedSongs.map(s => `- ${s}`).join('\n') : '- Ninguna'}
22. NO repitas estos artistas ya generados en lotes anteriores:
${usedArtists.length ? usedArtists.map(a => `- ${a}`).join('\n') : '- Ninguno'}
23. Genera EXACTAMENTE ${batchSize} canciones en este lote.

Responde ÚNICAMENTE con JSON válido.
No incluyas texto antes ni después.
No uses markdown.
No uses bloques \`\`\`.

${includeMeta ? `
Devuelve exactamente esta estructura:
{
  "playlistName": "nombre poético",
  "description": "descripción editorial breve",
  "songs": [
    { "title": "título real", "artist": "artista real", "genre": "género específico" }
  ]
}
` : `
Devuelve exactamente esta estructura:
{
  "songs": [
    { "title": "título real", "artist": "artista real", "genre": "género específico" }
  ]
}
`}
`.trim();
}

async function callAnthropic(prompt) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 5000,
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  const anthropicJson = await anthropicRes.json();

  if (!anthropicRes.ok) {
    console.error('Anthropic error FULL:', anthropicJson);
    throw new Error(JSON.stringify(anthropicJson));
  }

  const text = anthropicJson.content?.map(block => block.text || '').join('') || '';
  const jsonCandidate = extractJsonCandidate(text);

  try {
    return JSON.parse(jsonCandidate);
  } catch (e) {
    console.error('JSON parse error RAW:', text);
    console.error('JSON parse error CANDIDATE:', jsonCandidate);
    throw new Error(JSON.stringify({
      error: 'Anthropic no devolvió JSON válido',
      raw: text,
      jsonCandidate
    }));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'No API KEY' });
  }

  try {
    const { perfil, contexto, historial } = req.body || {};

    if (!perfil || !contexto) {
      return res.status(400).json({ error: 'Faltan datos de perfil o contexto' });
    }

    const lat = Number(contexto.lat);
    const lon = Number(contexto.lon);

    let climaTexto = 'Sin clima disponible';
    let climaData = null;

    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&hourly=temperature_2m,weathercode&forecast_days=1&timezone=auto`
      );

      if (weatherRes.ok) {
        const weatherJson = await weatherRes.json();
        climaData = weatherJson.current || null;

        const code = climaData?.weathercode;
        const temp = climaData?.temperature_2m;

        let estado = 'templado';
        if (temp <= 10) estado = 'frío';
        else if (temp >= 30) estado = 'caluroso';
        else if ([61, 63, 65, 80, 81, 82].includes(code)) estado = 'lluvioso';
        else if ([1, 2, 3, 45, 48].includes(code)) estado = 'nublado';
        else estado = 'soleado';

        climaTexto = `Clima actual: ${estado}, ${temp}°C, weather code ${code}`;
      }
    }

    const cancionesRecientes = (historial?.songs || []).slice(0, 120);
    const artistasRecientes = (historial?.artists || []).slice(0, 80);

    const requestedSongCount = Number(contexto.songCount);
    const requestedHours = Number(contexto.dur) || 4;

    const totalSongs = clamp(
      Number.isFinite(requestedSongCount) && requestedSongCount > 0
        ? requestedSongCount
        : Math.round(requestedHours * 15),
      15,
      120
    );

    let batchSize = 40;
    if (totalSongs <= 20) batchSize = totalSongs;
    else if (totalSongs <= 40) batchSize = 20;
    else if (totalSongs <= 80) batchSize = 30;

    let allSongs = [];
    let usedSongs = [];
    let usedArtists = [];
    let playlistName = '';
    let description = '';

    while (allSongs.length < totalSongs) {
      const remaining = totalSongs - allSongs.length;
      const currentBatchSize = Math.min(batchSize, remaining);

      const prompt = buildPrompt({
        perfil,
        contexto: {
          ...contexto,
          songCount: totalSongs,
          dur: requestedHours
        },
        climaTexto,
        cancionesRecientes,
        artistasRecientes,
        usedSongs,
        usedArtists,
        batchSize: currentBatchSize,
        includeMeta: !playlistName
      });

      const parsed = await callAnthropic(prompt);

      if (!playlistName && parsed.playlistName) {
        playlistName = parsed.playlistName;
      }

      if (!description && parsed.description) {
        description = parsed.description;
      }

      const batchSongs = uniqueSongs(parsed.songs || []);

      if (!batchSongs.length) {
        return res.status(500).json({
          error: 'Anthropic devolvió un lote vacío',
          parsed
        });
      }

      allSongs = uniqueSongs([...allSongs, ...batchSongs]);
      usedSongs = allSongs.map(s => `${s.title} - ${s.artist}`);
      usedArtists = [...new Set(allSongs.map(s => s.artist))];

      if (batchSongs.length < currentBatchSize) {
        break;
      }
    }

    allSongs = uniqueSongs(allSongs).slice(0, totalSongs);

    if (!allSongs.length) {
      return res.status(500).json({ error: 'No se pudieron generar canciones' });
    }

    return res.status(200).json({
      playlistName: playlistName || `Selección para ${perfil.nombre || 'tu lugar'}`,
      description: description || 'Playlist curada según el perfil del negocio, el momento del día y el clima.',
      songs: allSongs,
      clima: climaData
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Error generando playlist',
      details: String(error?.message || error)
    });
  }
}
