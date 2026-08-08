/* ═══════════════════════════════════════════════════════════════════
   TOKEN — точка входа

   Один долгоживущий Node-процесс: HTTP + WebSocket + SQLite.
   Ровно то, что записано в docs/ARCHITECTURE.md как вариант A.
   ═══════════════════════════════════════════════════════════════════ */
const path = require('path');
const http = require('http');
const express = require('express');

const A = require('./auth.js');
const api = require('./api.js');
const live = require('./live.js');
const { db } = require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(A.attach);

/* страницы, доступные без входа */
const OPEN_PAGES = new Set(['/login.html', '/favicon.ico']);

/* Гость не должен получать разметку кабинета: уводим на вход сразу,
   до отдачи файла. Клиент тоже проверяет, но решает сервер. */
app.get(/\.html$/, (req, res, next) => {
  if (OPEN_PAGES.has(req.path) || req.user) return next();
  const next_ = encodeURIComponent(req.path.replace(/^\//, '') + (req._parsedUrl.search || ''));
  res.redirect('/login.html?next=' + next_);
});

app.use('/api', api);

app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login.html');
  res.redirect(A.ROLES[req.user.role].home);
});

app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { maxAge: 0 }));
app.use(express.static(PUBLIC, { extensions: ['html'], etag: true, maxAge: 0 }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error:'Нет такого метода' });
  res.status(404).sendFile(path.join(PUBLIC, 'login.html'));
});

app.use((err, req, res, next) => {
  console.error('[ошибка]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error:'Внутренняя ошибка сервера' });
});

const server = http.createServer(app);
app.locals.live = live.create(server);

server.listen(PORT, () => {
  const counts = {
    предметов: db.prepare('SELECT COUNT(*) n FROM subjects').get().n,
    задач: db.prepare('SELECT COUNT(*) n FROM tasks').get().n,
    пользователей: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    занятий: db.prepare('SELECT COUNT(*) n FROM lessons').get().n,
  };
  console.log('\n  Token запущен');
  console.log('  http://localhost:' + PORT);
  console.log('  база: data/token.db  ·  ' +
    Object.entries(counts).map(([k, v]) => k + ': ' + v).join(', '));
  console.log('');
});

function shutdown() {
  console.log('\n  остановка…');
  server.close(() => { try { db.close(); } catch (e) {} process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
