const { v7: uuidv7 } = require('uuid');
const { loadConfig } = require('./config.js');
const { AuthService, hashPassword, verifyPassword } = require('../modules/identity/application/auth-service.js');

const COOKIE = 'token_sid';
const DEVICE_COOKIE = 'token_device';
const ROLES = {
  student: { label: 'Ученик', home: '/index.html', enabled: true },
  tutor: { label: 'Репетитор', home: '/tutor.html', enabled: true },
  parent: { label: 'Родитель', home: '/parent.html', enabled: false },
  admin: { label: 'Администратор', home: '/admin.html', enabled: false },
};
const uid = () => uuidv7();

function createAuthService(config, pool, email, logger) {
  const options = {
    email,
    logger,
    publicOrigin:config.publicOrigin || `http://localhost:${config.port}`,
    exposeTokens:config.nodeEnv === 'test',
    privilegedRoles:['admin'],
  };
  if (config.databaseDriver === 'postgres') {
    const { PostgresIdentityStore } = require('../modules/identity/infrastructure/postgres-identity-store.js');
    return new AuthService(new PostgresIdentityStore(pool), ROLES, options);
  }
  const { SqliteIdentityStore } = require('../modules/identity/infrastructure/sqlite-identity-store.js');
  return new AuthService(new SqliteIdentityStore(), ROLES, options);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const cookie = raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function attach(req, res, next) {
  req.sessionToken = readCookie(req, COOKIE);
  req.deviceToken = readCookie(req, DEVICE_COOKIE);
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
/**
 * Куки доверенного устройства. SameSite=strict, потому что она нужна только
 * на собственной форме входа: пускать её в кросс-сайтовые переходы значило бы
 * дарить второй фактор любому стороннему сайту, который откроет наш логин.
 */
function setDeviceCookie(res, token, expires) {
  const config = res.app?.locals?.config || loadConfig();
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
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
  DEVICE_COOKIE,
  uid,
  createAuthService,
  attach,
  setCookie,
  setDeviceCookie,
  clearCookie,
  requireUser,
  requireRole,
  hashPassword,
  verifyPassword,
};
