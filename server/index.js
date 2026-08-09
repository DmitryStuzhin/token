import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';
import { listTasks, runKompegeImport } from './importer.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use('/media', express.static(config.storageDir, { immutable: true, maxAge: '1y', fallthrough: false }));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable' }); }
});
app.get('/api/tasks', async (_req, res, next) => { try { res.json(await listTasks()); } catch (e) { next(e); } });
app.post('/api/imports/kompege', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.tasks)) return res.status(400).json({ error: 'Поле tasks должно быть массивом ID или URL' });
    res.status(201).json(await runKompegeImport(req.body.tasks));
  } catch (e) { next(e); }
});

app.use(express.static(path.resolve('.'), { extensions: ['html'] }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Внутренняя ошибка' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`arcs.studio: ${config.publicBaseUrl}`);
});
