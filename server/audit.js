const MUTATION_ACTION = Object.freeze({
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
});
const SENSITIVE_READS = [
  /^\/api\/v1\/profile$/,
  /^\/api\/v1\/lessons\/[^/]+$/,
  /^\/api\/state(?:\.js)?$/,
];

function resourceOf(pathname) {
  const parts = pathname
    .replace(/^\/api(?:\/v1)?\//, '')
    .split('/')
    .filter(Boolean);
  return parts[0] || 'unknown';
}

function auditSubjectOperations(req, res, next) {
  if (!req.user) return next();
  const action =
    MUTATION_ACTION[req.method] ||
    (SENSITIVE_READS.some((pattern) => pattern.test(req.path)) ? 'read' : null);
  if (!action) return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    void req.app.locals.auth.security('subject_access', {
      userId: req.user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: {
        action,
        resource: resourceOf(req.path),
        method: req.method,
        path: req.path,
        requestId: req.id,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
    });
  });
  next();
}

module.exports = { auditSubjectOperations, resourceOf };
