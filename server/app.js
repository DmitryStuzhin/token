const path = require('path');
const express = require('express');

const A = require('./auth.js');
const api = require('./api.js');
const apiV1 = require('./api-v1.js');
const { createLogger, requestContext } = require('./logger.js');
const { securityHeaders, sameOriginProtection, rateLimit } = require('./security.js');
const { createContainer } = require('../modules/composition.ts');

const PUBLIC = path.join(__dirname, '..', 'public');
const OPEN_PAGES = new Set(['/login.html', '/favicon.ico']);

function createApp(options = {}) {
  const config = options.config || require('./config.js').loadConfig();
  const logger = options.logger || createLogger(config.logLevel);
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.locals.config = config;
  app.locals.logger = logger;
  app.locals.live = options.live || { push() {}, presence() {}, invalidate() {} };
  app.locals.services = options.services || createContainer(config);
  app.locals.auth = options.auth || A.createAuthService(config, app.locals.services.pool);
  if (options.repository) {
    app.locals.repository = options.repository;
  } else if (config.databaseDriver === 'postgres') {
    const { PostgresPlatformRepository } = require('../modules/platform/infrastructure/postgres-platform-repository.js');
    app.locals.repository = new PostgresPlatformRepository(app.locals.services.pool);
  } else {
    const { SqlitePlatformRepository } = require('../modules/platform/infrastructure/sqlite-platform-repository.js');
    app.locals.repository = new SqlitePlatformRepository();
  }
  app.locals.services.events.subscribe('LessonCompleted', event => {
    logger.info('domain_event', {
      eventId: event.eventId,
      eventName: event.eventName,
      aggregateId: event.aggregateId,
    });
  });

  app.use(requestContext(logger));
  app.use(securityHeaders(config));
  app.use('/api/v1/auth/login', rateLimit({ limit: 5, windowMs: 15 * 60_000 }));
  app.use('/api/auth/login', rateLimit({ limit: 5, windowMs: 15 * 60_000 }));
  app.use('/api/v1/auth/register', rateLimit({ limit: 10, windowMs: 60 * 60_000 }));
  app.use('/api/auth/register', rateLimit({ limit: 10, windowMs: 60 * 60_000 }));
  app.use('/api/v1/invites', rateLimit({ limit: 30, windowMs: 15 * 60_000 }));
  app.use('/api/invites', rateLimit({ limit: 30, windowMs: 15 * 60_000 }));
  app.use(sameOriginProtection(config));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    if (config.writeFreeze && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'Запись временно приостановлена для обслуживания' });
    }
    next();
  });
  app.use(A.attach);

  app.get('/health/live', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', async (req, res) => {
    try {
      await app.locals.auth.ready();
      res.json({ status: 'ready', checks: { database: 'ok' } });
    } catch (error) {
      logger.error('readiness_failed', { requestId: req.id, error: error.message });
      res.status(503).json({ status: 'not_ready', checks: { database: 'failed' } });
    }
  });

  app.get(/\.html$/, (req, res, next) => {
    if (OPEN_PAGES.has(req.path) || req.user) return next();
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const nextPath = encodeURIComponent(req.path.replace(/^\//, '') + query);
    res.redirect('/login.html?next=' + nextPath);
  });

  app.use('/api/v1', apiV1);
  app.use('/api', api);

  app.get('/', (req, res) => {
    if (!req.user) return res.redirect('/login.html');
    res.redirect(A.ROLES[req.user.role].home);
  });

  app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { maxAge: 0 }));
  app.use(express.static(PUBLIC, { extensions: ['html'], etag: true, maxAge: 0 }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Нет такого метода' });
    res.status(404).sendFile(path.join(PUBLIC, 'login.html'));
  });

  app.use((err, req, res, next) => {
    const badJson = err && err.type === 'entity.parse.failed';
    const applicationStatus = err && {
      VALIDATION_ERROR: 400,
      INVALID_TRANSITION: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
    }[err.code];
    logger.error('request_failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      error: err && err.message ? err.message : 'Unknown error',
    });
    if (res.headersSent) return next(err);
    if (badJson) {
      if (req.path.startsWith('/api/v1/')) {
        return res.status(400).type('application/problem+json').json({
          type:'https://token.local/problems/400', title:'Некорректный JSON', status:400,
          detail:'Тело запроса содержит некорректный JSON', instance:req.originalUrl,
          requestId:req.id,
        });
      }
      return res.status(400).json({ error: 'Некорректный JSON', requestId: req.id });
    }
    if (applicationStatus) {
      if (req.path.startsWith('/api/v1/')) {
        return res.status(applicationStatus).type('application/problem+json').json({
          type:`https://token.local/problems/${applicationStatus}`,
          title:applicationStatus === 409 ? 'Конфликт' : 'Ошибка операции',
          status:applicationStatus, detail:err.message, instance:req.originalUrl,
          requestId:req.id,
        });
      }
      return res.status(applicationStatus).json({ error: err.message, requestId: req.id });
    }
    if (req.path.startsWith('/api/v1/')) {
      return res.status(500).type('application/problem+json').json({
        type:'https://token.local/problems/500', title:'Внутренняя ошибка', status:500,
        detail:'Внутренняя ошибка сервера', instance:req.originalUrl, requestId:req.id,
      });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера', requestId: req.id });
  });

  return app;
}

module.exports = { createApp };
