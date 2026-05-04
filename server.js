const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'reporte-buses-stm.html'));
});
app.get('/reporte-buses-stm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'reporte-buses-stm.html'));
});
app.post('/api/buses', async (req, res) => {
  try {
    const r = await fetch('http://www.montevideo.gub.uy/buses/rest/stm-online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    res.json(await r.json());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
app.listen(process.env.PORT || 3001);
