const MODEL = 'claude-sonnet-4-5';
const MAX_SONGS = 100;
const BATCH_SIZE = 35;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalize(value) {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function uniqueSongs(songs) {
  const seen = new Set();
  const result = [];

  for (const song of songs || []) {
    if (!song || !song.title || !song.artist) continue;
    const key = `${normalize(song.title)}|||${normalize(song.artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      title: String(song.title).trim(),
      artist: String(song.artist).trim(),
      genre: String(song.genre || '').trim()
    });
  }

  return result;
}

function extractJsonCandidate(text) {
  const cleanText = (text || '')
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

async function callAnthropic(prompt) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const anthropicJson = await anthropicRes.json();

  if (!anthropicRes.ok) {
    console.error('Anthropic error:', anthropicJson);
    throw new Error(anthropicJson?.error?.message || 'Anthropic API error');
  }

  const text = anthropicJson.content?.map(block => block.text || '').join('') || '';

  if (anthropicJson.stop_reason === 'max_tokens') {
    console.error('Anthropic response truncated:', text);
    throw new Error('Anthropic response truncated');
  }

  const candidate = extractJsonCandidate(text);

  try {
    return JSON.parse(candidate);
  } catch (error) {
    console.error('JSON parse error RAW:', text);
    console.error('JSON parse error CANDIDATE:', candidate);
    throw new Error('Anthropic did not return valid JSON');
  }
}

function buildPrompt({ perfil, contexto, climaTexto, historial, alreadySelected, count }) {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const recentSongs = (historial?.songs || []).slice(0, 150);
  const recentArtists = (historial?.artists || []).slice(0, 100);
  const selectedSongs = alreadySelected.slice(-100).map(s => `${s.title} - ${s.artist}`);
  const selectedArtists = [...new Set(alreadySelected.slice(-100).map(s => s.artist))];

  return `
Eres un curador musical experto en identidad sonora para negocios.
Tu trabajo NO es hacer una playlist generica de streaming.
Tu trabajo es hacer una seleccion editorial, distintiva, elegante, actual y poco obvia.

NEGOCIO:
- Nombre: ${perfil.nombre || ''}
- Tipo: ${perfil.tipo || ''}
- Subtipo: ${perfil.subtipo || ''}
- Ciudad: ${perfil.ciudad || ''}
- Edad cliente: ${perfil.edad || ''}
- Genero predominante cliente: ${perfil.gcliente || ''}
- Descripcion del cliente: ${perfil.cdesc || ''}
- Cliente ideal: ${perfil.cideal || ''}
- Vibe: ${perfil.vibe || ''}
- Referencias: ${perfil.refs || ''}
- Permanencia: ${perfil.permanencia || ''}
- Ruido: ${perfil.ruido || ''}
- Dinamica: ${perfil.dinamica || ''}
- Estetica: ${perfil.estetica || ''}
- No quiere: ${perfil.nowant || ''}
- Horario operacion: ${perfil.horarioop || ''}

CONTEXTO DEL MOMENTO:
- Horario actual de uso: ${contexto.horario || ''}
- Objetivo musical: ${contexto.mood || ''}
- Duracion solicitada: ${contexto.dur || ''} horas
- ${climaTexto}

GENERA EXACTAMENTE ${count} CANCIONES NUEVAS PARA ESTE BLOQUE.

REGLAS EDITORIALES OBLIGATORIAS:
1. Evita musica demasiado comercial, demasiado obvia, demasiado viral o demasiado gastada.
2. No hagas una playlist de grandes exitos.
3. No suenes a playlist generica de cafeteria, hotel, tienda o restaurante.
4. Prioriza criterio editorial, descubrimiento, profundidad y coherencia con el negocio.
5. Mezcla familiaridad y descubrimiento. Como guia aproximada: 70% distintiva/poco obvia, 20% familiar no quemada y maximo 10% muy reconocible.
6. Incluye musica de ${currentYear} y ${previousYear} cuando encaje con el perfil, mezclada con otras epocas. La playlist debe sentirse viva y actual, no nostalgica ni basada solo en novedades.
7. Puedes usar jazz, soul, pop, hip-hop, R&B, funk, disco, house, electronica, ambient, indie, bossa, Afro, Latin, downtempo, trip-hop, neo-soul, world y otros generos, PERO solo si encajan con el negocio y el momento. No fuerces variedad artificial.
8. No repitas canciones.
9. Evita repetir artistas siempre que sea posible. En playlists largas, un artista puede aparecer maximo 2 veces y nunca de forma cercana.
10. No inventes canciones ni artistas. Usa solo canciones reales y plausibles de encontrar en Spotify.
11. Respeta estrictamente lo que el negocio indico que NO quiere.
12. Si dudas entre una cancion famosa y una mejor curada, elige la mejor curada.

EVITA ESTAS CANCIONES DEL HISTORIAL:
${recentSongs.length ? recentSongs.map(s => `- ${s}`).join('\n') : '- Ninguna'}

EVITA ESTOS ARTISTAS DEL HISTORIAL CUANDO SEA POSIBLE:
${recentArtists.length ? recentArtists.map(a => `- ${a}`).join('\n') : '- Ninguno'}

YA SELECCIONADAS EN ESTA PLAYLIST. NO REPITAS ESTAS CANCIONES:
${selectedSongs.length ? selectedSongs.map(s => `- ${s}`).join('\n') : '- Ninguna'}

ARTISTAS YA USADOS EN ESTA PLAYLIST. EVITA REPETIRLOS SALVO QUE SEA NECESARIO:
${selectedArtists.length ? selectedArtists.map(a => `- ${a}`).join('\n') : '- Ninguno'}

Responde UNICAMENTE con JSON valido. No uses markdown ni texto antes o despues.

Estructura exacta:
{
  "playlistName": "nombre poetico y corto",
  "description": "descripcion editorial breve",
  "songs": [
    { "title": "titulo real", "artist": "artista real", "genre": "genero especifico" }
  ]
}
`.trim();
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
      try {
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`
        );

        if (weatherRes.ok) {
          const weatherJson = await weatherRes.json();
          climaData = weatherJson.current || null;

          const code = climaData?.weathercode;
          const temp = Number(climaData?.temperature_2m);
          let estado = 'templado';

          if (!Number.isNaN(temp)) {
            if (temp <= 10) estado = 'frio';
            else if (temp >= 30) estado = 'caluroso';
            else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) estado = 'lluvioso';
            else if ([1, 2, 3, 45, 48].includes(code)) estado = 'nublado';
            else estado = 'soleado';
          }

          climaTexto = `Clima actual: ${estado}, ${Number.isNaN(temp) ? 'temperatura no disponible' : `${temp} C`}, weather code ${code}`;
        }
      } catch (weatherError) {
        console.warn('Weather error:', weatherError);
      }
    }

    const requested = Number(contexto.songCount) || Number(contexto.dur || 4) * 15;
    const totalSongs = clamp(Math.round(requested), 1, MAX_SONGS);

    let allSongs = [];
    let playlistName = '';
    let description = '';
    let attempts = 0;
    const maxAttempts = Math.ceil(totalSongs / BATCH_SIZE) + 4;

    while (allSongs.length < totalSongs && attempts < maxAttempts) {
      attempts += 1;
      const remaining = totalSongs - allSongs.length;
      const targetCount = Math.min(BATCH_SIZE, remaining);

      const prompt = buildPrompt({
        perfil,
        contexto: { ...contexto, songCount: totalSongs },
        climaTexto,
        historial,
        alreadySelected: allSongs,
        count: targetCount
      });

      const parsed = await callAnthropic(prompt);

      if (!playlistName && parsed?.playlistName) playlistName = String(parsed.playlistName).trim();
      if (!description && parsed?.description) description = String(parsed.description).trim();

      const incoming = uniqueSongs(parsed?.songs || []);
      const before = allSongs.length;
      allSongs = uniqueSongs([...allSongs, ...incoming]).slice(0, totalSongs);

      if (allSongs.length === before) {
        console.warn('No new unique songs returned on attempt', attempts);
      }
    }

    if (!allSongs.length) {
      return res.status(500).json({ error: 'No se pudieron generar canciones validas' });
    }

    return res.status(200).json({
      playlistName: playlistName || 'Particula del dia',
      description: description || 'Seleccion curada para el momento y el perfil del negocio.',
      songs: allSongs.slice(0, totalSongs),
      requestedSongCount: totalSongs,
      partial: allSongs.length < totalSongs,
      clima: climaData
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: 'Error generando playlist',
      detail: error?.message || String(error)
    });
  }
}
