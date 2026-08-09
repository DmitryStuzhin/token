const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../../server/app.js');
const { loadConfig } = require('../../server/config.js');
const { hashPassword, verifyPassword, AuthService } = require('../../modules/identity/application/auth-service.js');
const { createLogger } = require('../../server/logger.js');

function productionLikeConfig() {
  return Object.freeze({
    ...loadConfig({ NODE_ENV:'test' }),
    nodeEnv:'production',
    publicOrigin:'https://tokenapp.ru',
    trustProxy:true,
    cookieSecure:true,
  });
}

test('production responses enforce transport, framing and origin protections', async () => {
  const app = createApp({ config:productionLikeConfig() });
  const page = await request(app).get('/login.html');
  assert.equal(page.status, 200);
  assert.match(page.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const rejected = await request(app).post('/api/v1/auth/login').send({
    email:'nobody@example.test', password:'test-password',
  });
  assert.equal(rejected.status, 403);
  assert.match(rejected.body.error, /межсайтовой/);

  const acceptedOrigin = await request(app).post('/api/v1/auth/login')
    .set('Origin', 'https://tokenapp.ru')
    .send({ email:'nobody@example.test', password:'test-password' });
  assert.equal(acceptedOrigin.status, 401);
});

test('authentication endpoints are rate limited', async () => {
  const app = createApp({ config:loadConfig({ NODE_ENV:'test' }) });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request(app).post('/api/v1/auth/login').send({
      email:'nobody@example.test', password:'test-password',
    });
    assert.equal(response.status, 401);
  }
  const limited = await request(app).post('/api/v1/auth/login').send({
    email:'nobody@example.test', password:'test-password',
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1);
});

test('new passwords use Argon2id and legacy scrypt upgrades after login', async () => {
  const modern = await hashPassword('test-password');
  assert.match(modern.hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword('test-password', modern.hash, modern.salt), true);

  const crypto = require('node:crypto');
  const salt = 'legacy-salt';
  const user = {
    id:'legacy-user', role:'tutor', pass_salt:salt,
    pass_hash:crypto.scryptSync('test-password', salt, 64).toString('hex'),
  };
  let upgraded = null;
  const store = {
    async findUserByEmail() { return user; },
    async updatePassword(id, credentials) { upgraded = { id, ...credentials }; },
  };
  const service = new AuthService(store, { tutor:{ enabled:true, label:'Репетитор' } });
  assert.equal((await service.login('legacy@example.test', 'test-password')).user, user);
  assert.equal(upgraded.id, user.id);
  assert.match(upgraded.hash, /^\$argon2id\$/);
});

test('structured logger redacts secrets and personal fields', () => {
  const rows = [];
  const logger = createLogger('info', { log:value => rows.push(value), warn() {}, error() {} });
  logger.info('security_test', {
    email:'person@example.test', password:'secret', answer:'42', nested:{ token:'abc' }, safe:'visible',
  });
  const payload = JSON.parse(rows[0]);
  assert.equal(payload.email, '[REDACTED]');
  assert.equal(payload.nested.token, '[REDACTED]');
  assert.equal(payload.safe, 'visible');
  assert.doesNotMatch(rows[0], /person@example|secret|"42"|"abc"/);
});
