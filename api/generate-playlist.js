const MODEL = 'claude-sonnet-4-5';
const MAX_SONGS = 100;
const BATCH_SIZE = 35;

// Mezcla editorial objetivo:
// 25% lanzamientos del año actual
// 20% lanzamientos del año anterior
// 55% catálogo anterior
const CURRENT_YEAR_SHARE = 0.25;
const PREVIOUS_YEAR_SHARE = 0.20;

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

function normalizeYear(value) {
  const year = Number.parseInt(value, 10);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
    return null;
  }

  return year;
}

function songKey(song) {
  return `${normalize(song?.title)}|||${normalize(song?.artist)}`;
}

function cleanSong(song) {
  if (!song || !song.title || !song.artist) return null;

  return {
    title: String(song.title).trim(),
    artist: String(song.artist).trim(),
    genre: String(song.genre || '').trim(),
    year: normalizeYear(song.year)
  };
}

function uniqueSongs(songs) {
  const seen = new Set();
  const result = [];

  for (const rawSong of songs || []) {
    const song = cleanSong(rawSong);
    if (!song) continue;

    const key = songKey(song);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(song);
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
      max_tokens: 7000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  const anthropicJson = await anthropicRes.json();

  if (!anthropicRes.ok) {
    console.error('Anthropic error:', anthropicJson);
    throw new Error(
      anthropicJson?.error?.message || 'Anthropic API error'
    );
  }

  const text =
    anthropicJson.content?.map(block => block.text || '').join('') || '';

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

function buildFreshnessPlan(totalSongs, contexto = {}) {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  const requestedTargets = contexto?.freshnessTargets || null;

  if (requestedTargets) {
    const targetCurrent = clamp(
      Math.round(Number(requestedTargets.current) || 0),
      0,
      totalSongs
    );

    const targetPrevious = clamp(
      Math.round(Number(requestedTargets.previous) || 0),
      0,
      totalSongs - targetCurrent
    );

    const targetOlder = clamp(
      Math.round(Number(requestedTargets.older) || 0),
      0,
      totalSongs - targetCurrent - targetPrevious
    );

    const assigned = targetCurrent + targetPrevious + targetOlder;
    const remainder = Math.max(0, totalSongs - assigned);

    return {
      currentYear,
      previousYear,
      targetCurrent,
      targetPrevious,
      targetOlder: targetOlder + remainder
    };
  }

  let targetCurrent = Math.round(totalSongs * CURRENT_YEAR_SHARE);
  let targetPrevious = Math.round(totalSongs * PREVIOUS_YEAR_SHARE);

  // En playlists cortas forzamos presencia visible de música reciente.
  if (totalSongs >= 10) {
    targetCurrent = Math.max(targetCurrent, 3);
    targetPrevious = Math.max(targetPrevious, 2);
  }

  if (targetCurrent + targetPrevious > totalSongs) {
    targetPrevious = Math.max(0, totalSongs - targetCurrent);
  }

  const targetOlder = totalSongs - targetCurrent - targetPrevious;

  return {
    currentYear,
    previousYear,
    targetCurrent,
    targetPrevious,
    targetOlder
  };
}

function classifySongYear(song, plan) {
  if (!song?.year) return 'unknown';
  if (song.year === plan.currentYear) return 'current';
  if (song.year === plan.previousYear) return 'previous';
  if (song.year < plan.previousYear) return 'older';
  return 'unknown';
}

function countFreshness(songs, plan) {
  const counts = {
    current: 0,
    previous: 0,
    older: 0,
    unknown: 0
  };

  for (const song of songs || []) {
    const bucket = classifySongYear(song, plan);
    counts[bucket] += 1;
  }

  return counts;
}

function getFreshnessDeficits(songs, plan) {
  const counts = countFreshness(songs, plan);

  return {
    current: Math.max(0, plan.targetCurrent - counts.current),
    previous: Math.max(0, plan.targetPrevious - counts.previous),
    older: Math.max(0, plan.targetOlder - counts.older)
  };
}

function allocateBatchTargets(deficits, batchCount) {
  const remainingTotal =
    deficits.current + deficits.previous + deficits.older;

  if (remainingTotal <= 0) {
    return { current: 0, previous: 0, older: 0 };
  }

  let current = Math.min(
    deficits.current,
    Math.round(batchCount * (deficits.current / remainingTotal))
  );

  let previous = Math.min(
    deficits.previous,
    Math.round(batchCount * (deficits.previous / remainingTotal))
  );

  let older = Math.min(
    deficits.older,
    batchCount - current - previous
  );

  // Si hay déficit de una categoría, intentamos que aparezca en el bloque.
  if (deficits.current > 0 && current === 0 && batchCount > 0) {
    current = 1;
  }

  if (
    deficits.previous > 0 &&
    previous === 0 &&
    current < batchCount
  ) {
    previous = 1;
  }

  older = Math.max(0, batchCount - current - previous);

  if (older > deficits.older) {
    let overflow = older - deficits.older;
    older = deficits.older;

    const addCurrent = Math.min(
      overflow,
      Math.max(0, deficits.current - current)
    );
    current += addCurrent;
    overflow -= addCurrent;

    const addPrevious = Math.min(
      overflow,
      Math.max(0, deficits.previous - previous)
    );
    previous += addPrevious;
    overflow -= addPrevious;

    older += overflow;
  }

  while (current + previous + older < batchCount) {
    if (current < deficits.current) current += 1;
    else if (previous < deficits.previous) previous += 1;
    else if (older < deficits.older) older += 1;
    else break;
  }

  while (current + previous + older > batchCount) {
    if (older > 0) older -= 1;
    else if (previous > 0) previous -= 1;
    else current -= 1;
  }

  return { current, previous, older };
}

function acceptSongsWithinPlan(existingSongs, incomingSongs, plan, maxTotal) {
  const existingKeys = new Set(existingSongs.map(songKey));
  const accepted = [];

  const counts = countFreshness(existingSongs, plan);
  const remaining = {
    current: Math.max(0, plan.targetCurrent - counts.current),
    previous: Math.max(0, plan.targetPrevious - counts.previous),
    older: Math.max(0, plan.targetOlder - counts.older)
  };

  for (const rawSong of incomingSongs || []) {
    if (existingSongs.length + accepted.length >= maxTotal) break;

    const song = cleanSong(rawSong);
    if (!song || !song.year) continue;

    const key = songKey(song);
    if (existingKeys.has(key)) continue;

    const bucket = classifySongYear(song, plan);
    if (bucket === 'unknown') continue;
    if (remaining[bucket] <= 0) continue;

    existingKeys.add(key);
    remaining[bucket] -= 1;
    accepted.push(song);
  }

  return accepted;
}

function buildPrompt({
  perfil,
  contexto,
  climaTexto,
  historial,
  alreadySelected,
  count,
  freshnessPlan,
  batchTargets
}) {
  const recentSongs = (historial?.songs || []).slice(0, 150);
  const recentArtists = (historial?.artists || []).slice(0, 100);

  const selectedSongs = alreadySelected
    .slice(-100)
    .map(s => `${s.title} - ${s.artist}`);

  const selectedArtists = [
    ...new Set(alreadySelected.slice(-100).map(s => s.artist))
  ];

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
- Duración solicitada: ${contexto.dur || ''} horas
- ${climaTexto}

GENERA EXACTAMENTE ${count} CANCIONES NUEVAS PARA ESTE BLOQUE.
${contexto.replacementMode ? '- Este bloque es de REEMPLAZO: no reutilices canciones ya propuestas y prioriza canciones fáciles de identificar exactamente en Spotify.' : ''}

CUOTAS OBLIGATORIAS DE ACTUALIDAD PARA ESTE BLOQUE:
- ${batchTargets.current} canciones cuyo PRIMER lanzamiento comercial de ESTA GRABACIÓN O VERSIÓN haya sido en ${freshnessPlan.currentYear}.
- ${batchTargets.previous} canciones cuyo PRIMER lanzamiento comercial de ESTA GRABACIÓN O VERSIÓN haya sido en ${freshnessPlan.previousYear}.
- ${batchTargets.older} canciones cuyo primer lanzamiento comercial haya sido en ${freshnessPlan.previousYear - 1} o antes.

DEFINICIÓN ESTRICTA DEL CAMPO "year":
- "year" significa el año del PRIMER lanzamiento comercial real de esa grabación o versión específica.
- NO uses el año de una recopilación posterior.
- NO uses el año de una reedición.
- NO uses el año de una deluxe edition si la canción ya existía antes.
- NO uses el año de un remaster.
- NO uses el año de una banda sonora, compilación o reempaque posterior si esa misma grabación ya había sido publicada.
- Si una canción de 2021 reaparece en un álbum o compilación de ${freshnessPlan.currentYear}, su year sigue siendo 2021.
- Un remix o edit sí puede contar como reciente SOLO si ESA versión concreta fue lanzada por primera vez en ${freshnessPlan.currentYear} o ${freshnessPlan.previousYear}.
- Si no estás razonablemente seguro del año original de lanzamiento, NO uses esa canción.
- Nunca inventes un año para cumplir la cuota.

REGLAS PARA LA MÚSICA RECIENTE:
- Las canciones de ${freshnessPlan.currentYear} y ${freshnessPlan.previousYear} deben sentirse realmente actuales.
- No elijas hits virales solo por ser nuevos.
- Busca lanzamientos recientes con criterio editorial y coherentes con el negocio.
- Si una canción reciente no encaja, reemplázala por otra reciente que sí encaje. NO elimines la cuota de actualidad.

REGLAS EDITORIALES OBLIGATORIAS:
1. Evita música demasiado comercial, demasiado obvia, demasiado viral o demasiado gastada.
2. No hagas una playlist de grandes éxitos.
3. No suenes a playlist genérica de cafetería, hotel, tienda o restaurante.
4. Prioriza criterio editorial, descubrimiento, profundidad y coherencia con el negocio.
5. Como guía aproximada: 70% distintiva/poco obvia, 20% familiar no quemada y máximo 10% muy reconocible.
6. La playlist debe sentirse viva en ${freshnessPlan.currentYear}: combina lanzamientos actuales con catálogo anterior de calidad.
7. No hagas nostalgia pura ni una lista compuesta solo por novedades.
8. Puedes usar jazz, soul, pop, hip-hop, R&B, funk, disco, house, electrónica, ambient, indie, bossa, Afro, Latin, downtempo, trip-hop, neo-soul, world y otros géneros, pero solo si encajan con el negocio y el momento.
9. No fuerces variedad artificial.
10. No repitas canciones.
11. Evita repetir artistas siempre que sea posible. En playlists largas, un artista puede aparecer máximo 2 veces y nunca de forma cercana.
12. No inventes canciones ni artistas.
13. Usa solo canciones reales y plausibles de encontrar en Spotify.
13A. Evita títulos ambiguos, aliases dudosos, bootlegs, edits no oficiales, uploads informales o canciones cuya existencia en Spotify no puedas sostener con alta confianza.
14. Respeta estrictamente lo que el negocio indicó que NO quiere.
15. Si dudas entre una canción famosa y una mejor curada, elige la mejor curada.
16. Evita karaoke, tribute, covers genéricos, live versions o regrabaciones salvo que sean editorialmente necesarias.

EVITA ESTAS CANCIONES DEL HISTORIAL:
${recentSongs.length ? recentSongs.map(s => `- ${s}`).join('\n') : '- Ninguna'}

EVITA ESTOS ARTISTAS DEL HISTORIAL CUANDO SEA POSIBLE:
${recentArtists.length ? recentArtists.map(a => `- ${a}`).join('\n') : '- Ninguno'}

YA SELECCIONADAS EN ESTA PLAYLIST. NO REPITAS ESTAS CANCIONES:
${selectedSongs.length ? selectedSongs.map(s => `- ${s}`).join('\n') : '- Ninguna'}

ARTISTAS YA USADOS EN ESTA PLAYLIST. EVITA REPETIRLOS SALVO QUE SEA NECESARIO:
${selectedArtists.length ? selectedArtists.map(a => `- ${a}`).join('\n') : '- Ninguno'}

RESPUESTA:
Devuelve ÚNICAMENTE JSON válido.
No uses markdown.
No escribas texto antes ni después.

Estructura exacta:
{
  "playlistName": "nombre poético y corto",
  "description": "descripción editorial breve",
  "songs": [
    {
      "title": "título real",
      "artist": "artista real",
      "genre": "género específico",
      "year": ${freshnessPlan.currentYear}
    }
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
      return res.status(400).json({
        error: 'Faltan datos de perfil o contexto'
      });
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
            if (temp <= 10) {
              estado = 'frío';
            } else if (temp >= 30) {
              estado = 'caluroso';
            } else if (
              [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)
            ) {
              estado = 'lluvioso';
            } else if ([1, 2, 3, 45, 48].includes(code)) {
              estado = 'nublado';
            } else {
              estado = 'soleado';
            }
          }

          climaTexto =
            `Clima actual: ${estado}, ` +
            `${Number.isNaN(temp) ? 'temperatura no disponible' : `${temp} C`}, ` +
            `weather code ${code}`;
        }
      } catch (weatherError) {
        console.warn('Weather error:', weatherError);
      }
    }

    const requested =
      Number(contexto.songCount) ||
      Number(contexto.dur || 4) * 15;

    const totalSongs = clamp(
      Math.round(requested),
      1,
      MAX_SONGS
    );

    const freshnessPlan = buildFreshnessPlan(totalSongs, contexto);

    let allSongs = [];
    let playlistName = '';
    let description = '';

    let attempts = 0;
    const baseBatches = Math.ceil(totalSongs / BATCH_SIZE);
    const maxAttempts = baseBatches + 6;

    while (
      allSongs.length < totalSongs &&
      attempts < maxAttempts
    ) {
      attempts += 1;

      const deficits = getFreshnessDeficits(
        allSongs,
        freshnessPlan
      );

      const remaining =
        deficits.current +
        deficits.previous +
        deficits.older;

      if (remaining <= 0) break;

      const targetCount = Math.min(
        BATCH_SIZE,
        remaining
      );

      const batchTargets = allocateBatchTargets(
        deficits,
        targetCount
      );

      const prompt = buildPrompt({
        perfil,
        contexto: {
          ...contexto,
          songCount: totalSongs
        },
        climaTexto,
        historial,
        alreadySelected: allSongs,
        count: targetCount,
        freshnessPlan,
        batchTargets
      });

      const parsed = await callAnthropic(prompt);

      if (!playlistName && parsed?.playlistName) {
        playlistName = String(
          parsed.playlistName
        ).trim();
      }

      if (!description && parsed?.description) {
        description = String(
          parsed.description
        ).trim();
      }

      const incoming = uniqueSongs(
        parsed?.songs || []
      );

      const accepted = acceptSongsWithinPlan(
        allSongs,
        incoming,
        freshnessPlan,
        totalSongs
      );

      if (!accepted.length) {
        console.warn(
          'No valid songs accepted on attempt',
          attempts,
          {
            requestedBatch: batchTargets,
            returned: incoming.length
          }
        );
      }

      allSongs = [
        ...allSongs,
        ...accepted
      ].slice(0, totalSongs);
    }

    const finalFreshness = countFreshness(
      allSongs,
      freshnessPlan
    );

    const complete =
      allSongs.length === totalSongs &&
      finalFreshness.current === freshnessPlan.targetCurrent &&
      finalFreshness.previous === freshnessPlan.targetPrevious &&
      finalFreshness.older === freshnessPlan.targetOlder &&
      finalFreshness.unknown === 0;

    if (!complete) {
      console.error('Freshness plan incomplete', {
        totalSongs,
        generated: allSongs.length,
        target: freshnessPlan,
        actual: finalFreshness
      });

      return res.status(500).json({
        error:
          'No se pudo completar la mezcla de actualidad requerida. Intenta generar de nuevo.',
        requestedSongCount: totalSongs,
        generatedSongCount: allSongs.length,
        freshness: {
          currentYear: freshnessPlan.currentYear,
          previousYear: freshnessPlan.previousYear,
          targetCurrent: freshnessPlan.targetCurrent,
          targetPrevious: freshnessPlan.targetPrevious,
          targetOlder: freshnessPlan.targetOlder,
          actualCurrent: finalFreshness.current,
          actualPrevious: finalFreshness.previous,
          actualOlder: finalFreshness.older,
          unknownYear: finalFreshness.unknown
        }
      });
    }

    return res.status(200).json({
      playlistName:
        playlistName || 'Partícula del día',
      description:
        description ||
        'Selección curada para el momento y el perfil del negocio.',
      songs: allSongs,
      requestedSongCount: totalSongs,
      partial: false,
      freshness: {
        currentYear: freshnessPlan.currentYear,
        previousYear: freshnessPlan.previousYear,
        targetCurrent: freshnessPlan.targetCurrent,
        targetPrevious: freshnessPlan.targetPrevious,
        targetOlder: freshnessPlan.targetOlder,
        actualCurrent: finalFreshness.current,
        actualPrevious: finalFreshness.previous,
        actualOlder: finalFreshness.older,
        unknownYear: finalFreshness.unknown
      },
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
