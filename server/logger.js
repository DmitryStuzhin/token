const crypto = require('crypto');

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger(level = 'info', sink = console) {
  const threshold = LEVEL_WEIGHT[level] == null ? LEVEL_WEIGHT.info : LEVEL_WEIGHT[level];

  function write(logLevel, message, fields = {}) {
    if (LEVEL_WEIGHT[logLevel] < threshold) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...fields,
    };
    const output = JSON.stringify(payload);
    const method = logLevel === 'error' ? 'error' : logLevel === 'warn' ? 'warn' : 'log';
    sink[method](output);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

function requestContext(logger) {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('http_request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user ? req.user.id : undefined,
      });
    });
    next();
  };
}

module.exports = { createLogger, requestContext };
