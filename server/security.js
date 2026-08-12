const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const APPLICATION_CSP =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; frame-src 'self'; worker-src 'none'";
function pythonRunnerCsp(publicOrigin) {
  return `default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; script-src ${publicOrigin} 'unsafe-eval'; script-src-attr 'none'; style-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'`;
}

function securityHeaders(config) {
  return (req, res, next) => {
    const pythonRunner = req.path === '/python-runner.html';
    const pythonRunnerAsset =
      req.path === '/assets/python-runner.js' || req.path.startsWith('/assets/vendor/skulpt/');
    const applicationCsp =
      config.nodeEnv === 'production'
        ? `${APPLICATION_CSP}; upgrade-insecure-requests`
        : APPLICATION_CSP;
    res.set({
      'Content-Security-Policy': pythonRunner
        ? pythonRunnerCsp(config.publicOrigin || `${req.protocol}://${req.get('host')}`)
        : applicationCsp,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': pythonRunnerAsset ? 'cross-origin' : 'same-origin',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'X-Content-Type-Options': 'nosniff',
    });
    if (!pythonRunner) res.set('X-Frame-Options', 'DENY');
    if (config.nodeEnv === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

function sameOriginProtection(config) {
  return (req, res, next) => {
    if (config.nodeEnv !== 'production' || SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('Origin');
    if (origin && origin === config.publicOrigin) return next();
    return res.status(403).json({ error: 'Запрос отклонён защитой от межсайтовой отправки' });
  };
}

function rateLimit(options = {}) {
  const buckets = new Map();
  const windowMs = options.windowMs || 15 * 60_000;
  const limit = options.limit || 10;
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}\u0000${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count <= limit) return next();
    res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: 'Слишком много попыток. Повторите позже.' });
  };
}

module.exports = { securityHeaders, sameOriginProtection, rateLimit };
