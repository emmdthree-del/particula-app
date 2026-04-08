export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    const prompt = `
Eres un curador musical experto en identidad sonora para negocios.
Tu trabajo NO es hacer una playlist genérica de streaming.
Tu trabajo es hacer una selección editorial, distintiva, elegante y poco obvia.

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
- Canciones requeridas: ${contexto.songCount || 60}
- ${climaTexto}

REGLAS EDITORIALES OBLIGATORIAS:
1. Evita música demasiado comercial, demasiado obvia, demasiado viral o demasiado gastada.
2. No hagas una playlist de “grandes éxitos”.
3. No suenes a playlist genérica de cafetería, hotel o tienda.
4. Prioriza criterio editorial, descubrimiento y profundidad.
5. Usa aprox:
   - 70% selección distintiva y poco obvia
   - 20% familiar pero no quemada
   - 10% reconocible como máximo
6. Mezcla países, idiomas y épocas si encajan.
7. No repitas artistas innecesariamente.
8. Si dudas entre una canción famosa y una mejor curada, elige la mejor curada.
9. NO inventes canciones ni artistas.
10. Devuelve únicamente canciones reales y plausibles.
11. Evita estas canciones recientes:
${cancionesRecientes.length ? cancionesRecientes.map(s => `- ${s}`).join('\\n') : '- Ninguna'}
12. Evita estos artistas recientes:
${artistasRecientes.length ? artistasRecientes.map(a => `- ${a}`).join('\\n') : '- Ninguno'}

SALIDA:
Devuelve únicamente JSON válido, sin markdown, sin explicación, con esta estructura exacta:
{
  "playlistName": "nombre poético",
  "description": "descripción editorial breve",
  "songs": [
    { "title": "título real", "artist": "artista real", "genre": "género específico" }
  ]
}
`.trim();

   try {

     const prompt = `
Eres un curador musical experto en identidad sonora para negocios.

Crea una playlist con estas condiciones:

NEGOCIO:
${JSON.stringify(perfil)}

CONTEXTO:
- Horario: ${contexto.horario}
- Mood: ${contexto.mood}
- Duración: ${contexto.dur} horas
- ${climaTexto}

REGLAS:
- Evita música comercial o muy conocida
- Mezcla géneros, países y épocas
- Mantén coherencia con el negocio
- No repitas artistas
- Devuelve canciones reales

Devuelve SOLO JSON válido con esta estructura:

{
  "playlistName": "",
  "description": "",
  "songs": [
    { "title": "", "artist": "", "genre": "" }
  ]
}
`.trim();

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    const anthropicJson = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic error:', anthropicJson);
      return res.status(500).json({ error: 'Error en Anthropic', details: anthropicJson });
    }

    const text = anthropicJson.content?.map(x => x.text || '').join('') || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error('JSON parse error:', text);
      return res.status(500).json({ error: 'Anthropic no devolvió JSON válido', raw: text });
    }

    return res.status(200).json({
      ...parsed,
      clima: climaData
    });

} catch (error) {
  console.error(error);
  return res.status(500).json({ error: 'Error generando playlist' });
} 
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error generando playlist' });
  }
}
