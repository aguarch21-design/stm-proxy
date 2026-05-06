const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());

// Load STM data (controles + horarios)
let STM_DATA = null;
try {
  STM_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'stm_data.json'), 'utf8'));
  console.log('STM data loaded OK');
} catch(e) {
  console.log('STM data not found:', e.message);
}

// Haversine distance in meters
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dlat = (lat2-lat1)*Math.PI/180;
  const dlon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dlat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dlon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Calculate delay for a bus
function calcDelay(linea, busLat, busLon) {
  if (!STM_DATA) return null;
  const ctrls = STM_DATA.controles[linea];
  if (!ctrls || !ctrls.length) return null;

  // Find nearest control point
  let nearest = null, minDist = Infinity;
  for (const c of ctrls) {
    const d = distM(busLat, busLon, c.la, c.lo);
    if (d < minDist) { minDist = d; nearest = c; }
  }
  if (minDist > 1000) return null; // too far from any control point

  // Get current time
  const now = new Date();
  // Uruguay is UTC-3
  const uyOffset = -3 * 3600;
  const utcSec = Math.floor(now.getTime()/1000) + now.getTimezoneOffset()*60;
  const uySec = utcSec + uyOffset + 10800; // UTC-3
  const nowSeg = ((uySec % 86400) + 86400) % 86400;
  
  const uyDate = new Date((utcSec + uyOffset + 10800) * 1000);
  const wd = uyDate.getDay(); // 0=sun,6=sat
  const day = (wd === 0) ? '2' : (wd === 6) ? '1' : '0';

  const lineaHor = STM_DATA.horarios[linea];
  if (!lineaHor) return null;
  const dayHor = lineaHor[day];
  if (!dayHor) return null;
  const horas = dayHor[nearest.c];
  if (!horas || !horas.length) return null;

  // Find closest scheduled time
  let closest = horas[0], minDiff = Infinity;
  for (const h of horas) {
    const diff = Math.abs(h - nowSeg);
    if (diff < minDiff) { minDiff = diff; closest = h; }
  }

  const atrasoSeg = nowSeg - closest;
  const hh = Math.floor(closest/3600).toString().padStart(2,'0');
  const mm = Math.floor((closest%3600)/60).toString().padStart(2,'0');

  return {
    atraso_seg: atrasoSeg,
    atraso_min: Math.round(atrasoSeg/60*10)/10,
    control: nearest.d,
    dist_m: Math.round(minDist),
    hora_teorica: `${hh}:${mm}`
  };
}

// Classify bus
function classifyBus(feature) {
  const p = feature.properties;
  const fr = p.frecuencia;
  const coords = feature.geometry ? feature.geometry.coordinates : null;

  // No GPS
  if (!fr || fr > 300000) return { cat: 'ng', atraso_min: null, control: null, hora_teorica: null };

  // Try to calculate real delay
  if (coords && p.linea && STM_DATA) {
    const delay = calcDelay(String(p.linea), coords[1], coords[0]);
    if (delay !== null) {
      const a = delay.atraso_min;
      let cat;
      if (Math.abs(a) <= 2) cat = 'ok';
      else if (a > 2) cat = 'late';
      else cat = 'early';
      return { cat, atraso_min: a, control: delay.control, hora_teorica: delay.hora_teorica, dist_m: delay.dist_m };
    }
  }

  // Fallback to frecuencia
  if (fr > 2*60*1000) return { cat: 'bad', atraso_min: null, control: null, hora_teorica: null };
  return { cat: 'ok', atraso_min: null, control: null, hora_teorica: null };
}

// Main API endpoint
app.post('/api/buses', async (req, res) => {
  try {
    const r = await fetch('http://www.montevideo.gub.uy/buses/rest/stm-online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    const data = await r.json();

    // Enrich features with delay info
    if (data.features) {
      for (const f of data.features) {
        const info = classifyBus(f);
        f.properties._cat = info.cat;
        f.properties._atraso_min = info.atraso_min;
        f.properties._control = info.control;
        f.properties._hora_teorica = info.hora_teorica;
        f.properties._dist_m = info.dist_m;
      }
    }

    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'reporte-buses-stm.html')));
app.get('/reporte-buses-stm.html', (req, res) => res.sendFile(path.join(__dirname, 'reporte-buses-stm.html')));

app.listen(process.env.PORT || 3001, () => console.log('STM server running'));
