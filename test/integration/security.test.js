const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  assert.match(page.headers['content-security-policy'], /style-src-attr 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const runner = await request(app).get('/python-runner.html');
  assert.equal(runner.status, 302);
  assert.match(runner.headers['content-security-policy'], /default-src 'none'/);
  assert.match(runner.headers['content-security-policy'], /script-src https:\/\/tokenapp\.ru 'unsafe-eval'/);
  assert.match(runner.headers['content-security-policy'], /frame-ancestors 'self'/);

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

test('frontend sources do not contain inline scripts, styles or event handlers', () => {
  const publicRoot = path.join(__dirname, '..', '..', 'public');
  const htmlFiles = fs.readdirSync(publicRoot).filter(file => file.endsWith('.html'));
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(publicRoot, file), 'utf8');
    assert.doesNotMatch(source, /<script(?![^>]*\bsrc=)/i, file);
    assert.doesNotMatch(source, /<style\b|\sstyle\s*=|\son[a-z]+\s*=/i, file);
  }

  const scriptRoots = [
    path.join(publicRoot, 'assets', 'ui.js'),
    path.join(publicRoot, 'assets', 'lesson-runtime.js'),
    ...fs.readdirSync(path.join(publicRoot, 'assets', 'pages'))
      .map(file => path.join(publicRoot, 'assets', 'pages', file)),
  ];
  for (const file of scriptRoots) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\sstyle\s*=|\son(?:click|change|input|submit|load|error|dblclick|pointer[a-z]*|mouse[a-z]*|key[a-z]*)\s*=/i,
      file,
    );
  }
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
    email_verified_at:new Date().toISOString(),
    pass_hash:crypto.scryptSync('test-password', salt, 64).toString('hex'),
  };
  let upgraded = null;
  const store = {
    async findUserByEmail() { return user; },
    async updatePassword(id, credentials) { upgraded = { id, ...credentials }; },
    async replaceAccountToken() {},
    async touchTrustedDevice() { return null; },
  };
  const service = new AuthService(store, { tutor:{ enabled:true, label:'Репетитор' } });
  // Верный пароль больше не отдаёт сессию сразу: дальше идёт код из письма.
  // Апгрейд хеша при этом обязан произойти уже на первом шаге.
  const started = await service.login('legacy@example.test', 'test-password');
  assert.equal(started.codeRequired, true);
  assert.equal(started.error, undefined);
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
