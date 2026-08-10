const { v7: uuidv7 } = require('uuid');
const { loadConfig } = require('./config.js');
const { AuthService, hashPassword, verifyPassword } = require('../modules/identity/application/auth-service.js');

const COOKIE = 'token_sid';
const ROLES = {
  student: { label: 'Ученик', home: '/index.html', enabled: true },
  tutor: { label: 'Репетитор', home: '/tutor.html', enabled: true },
  parent: { label: 'Родитель', home: '/parent.html', enabled: false },
};
const uid = () => uuidv7();

function createAuthService(config, pool, email, logger) {
  const options = {
    email,
    logger,
    publicOrigin:config.publicOrigin || `http://localhost:${config.port}`,
    exposeTokens:config.nodeEnv === 'test',
  };
  if (config.databaseDriver === 'postgres') {
    const { PostgresIdentityStore } = require('../modules/identity/infrastructure/postgres-identity-store.js');
    return new AuthService(new PostgresIdentityStore(pool), ROLES, options);
  }
  const { SqliteIdentityStore } = require('../modules/identity/infrastructure/sqlite-identity-store.js');
  return new AuthService(new SqliteIdentityStore(), ROLES, options);
}

function attach(req, res, next) {
  const raw = req.headers.cookie || '';
  const cookie = raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  req.sessionToken = cookie ? decodeURIComponent(cookie.slice(COOKIE.length + 1)) : null;
  Promise.resolve(req.app.locals.auth.userBySession(req.sessionToken))
    .then(async user => {
      req.user = user;
      if (user) {
        const profile = await req.app.locals.auth.profileOf(user);
        req.profile = profile || null;
        req.studentId = user.role === 'student' && profile ? profile.id : null;
        req.tutorId = user.role === 'tutor' && profile ? profile.id : null;
      }
      next();
    })
    .catch(next);
}

function setCookie(res, token, expires) {
  const config = res.app?.locals?.config || loadConfig();
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires,
    secure: config.cookieSecure,
  });
}
const clearCookie = res => res.clearCookie(COOKIE, { path: '/' });
const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Нужно войти' });
const requireRole = role => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти' });
  if (req.user.role !== role) return res.status(403).json({ error: 'Недостаточно прав' });
  if (role === 'tutor' && !req.tutorId) return res.status(403).json({ error: 'Профиль репетитора не найден' });
  if (role === 'student' && !req.studentId) return res.status(403).json({ error: 'Профиль ученика не найден' });
  next();
};

module.exports = {
  ROLES,
  COOKIE,
  uid,
  createAuthService,
  attach,
  setCookie,
  clearCookie,
  requireUser,
  requireRole,
  hashPassword,
  verifyPassword,
};
