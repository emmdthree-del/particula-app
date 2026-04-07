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

    // 👇 PEGA AQUÍ EL BLOQUE DEMO

    const mood = (contexto.mood || '').toLowerCase();
    const horario = (contexto.horario || '').toLowerCase();
    const climaMood = climaTexto.toLowerCase();

    let songs = [
      { title: 'Midnight City', artist: 'M83', genre: 'synth-pop nocturno' },
      { title: 'Teardrop', artist: 'Massive Attack', genre: 'trip-hop atmosférico' },
      { title: 'Weightless', artist: 'Marconi Union', genre: 'ambient terapéutico' },
      { title: 'Awake', artist: 'Tycho', genre: 'downtempo instrumental' },
      { title: 'Sunset Lover', artist: 'Petit Biscuit', genre: 'electrónica chill' },
      { title: 'Tadow', artist: 'Masego & FKJ', genre: 'nu-jazz sensual' },
      { title: 'Night Owl', artist: 'Galimatias', genre: 'future soul' },
      { title: 'Coffee', artist: 'Miguel', genre: 'r&b suave' }
    ];

    if (mood.includes('energía')) {
      songs = [
        { title: 'Back on 74', artist: 'Jungle', genre: 'funk contemporáneo' },
        { title: 'Electric Feel', artist: 'MGMT', genre: 'indie electrónico' },
        { title: 'Walking On A Dream', artist: 'Empire of the Sun', genre: 'synth-pop' },
        { title: '1901', artist: 'Phoenix', genre: 'indie francés' }
      ];
    }

    if (climaMood.includes('lluvioso') || climaMood.includes('frío')) {
      songs = [
        { title: 'Teardrop', artist: 'Massive Attack', genre: 'trip-hop atmosférico' },
        { title: 'Holocene', artist: 'Bon Iver', genre: 'folk atmosférico' },
        { title: 'Mystery of Love', artist: 'Sufjan Stevens', genre: 'folk íntimo' },
        { title: 'Porcelain', artist: 'Moby', genre: 'electrónica nostálgica' }
      ];
    }

    return res.status(200).json({
      playlistName: `Selección demo para ${perfil.nombre || 'tu lugar'}`,
      description: `Playlist demo curada según el momento y el contexto.`,
      songs,
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
