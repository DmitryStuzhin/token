const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-account-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.TOKEN_DB = path.join(testDir, 'test.db');
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = 'true';

const { createApp } = require('../../server/app.js');
const { loadConfig } = require('../../server/config.js');
const { db } = require('../../server/db.js');
const { signIn } = require('../helpers/auth.js');

const deliveries = [];
let outage = null;
const email = {
  async sendVerification(to, link, code) {
    if (outage) throw outage;
    deliveries.push({ type:'verify', to, link, code });
  },
  async sendPasswordReset(to, link) {
    if (outage) throw outage;
    deliveries.push({ type:'reset', to, link });
  },
  async sendLoginCode(to, code) {
    if (outage) throw outage;
    deliveries.push({ type:'login', to, code });
  },
  async verify() { if (outage) throw outage; },
};
const app = createApp({ config:loadConfig(), email });
const credentials = {
  name:'Жизненный Цикл', email:'lifecycle@example.test', password:'initial-password',
  role:'student', grade:11,
};

test.after(() => {
  db.close();
  fs.rmSync(testDir, { recursive:true, force:true });
});

test('email verification is mandatory, expiring and single-use', async () => {
  const agent = request.agent(app);
  const registration = await agent.post('/api/v1/auth/register').send(credentials);
  assert.equal(registration.status, 201);
  assert.equal(registration.body.verificationRequired, true);
  assert.equal(deliveries.at(-1).type, 'verify');
  assert.equal((await agent.get('/api/auth/me')).body.user, null);

  const blocked = await agent.post('/api/v1/auth/login').send(credentials);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'EMAIL_UNVERIFIED');

  const verification = new URL(registration.body.verificationUrl);
  assert.equal((await agent.get(verification.pathname + verification.search)).status, 302);
  assert.equal((await agent.get(verification.pathname + verification.search)).headers.location,
    '/login.html?verified=0');
  assert.equal((await signIn(agent, credentials.email, credentials.password, '/api/v1', '192.0.2.5')).status, 200);

  const expired = await request(app).post('/api/v1/auth/register').send({
    ...credentials, email:'expired@example.test',
  });
  db.prepare(`UPDATE account_tokens SET expires_at='2000-01-01T00:00:00.000Z'
    WHERE purpose='verify_email' AND consumed_at IS NULL`).run();
  const expiredUrl = new URL(expired.body.verificationUrl);
  assert.equal((await request(app).get(expiredUrl.pathname + expiredUrl.search)).headers.location,
    '/login.html?verified=0');
});

test('password reset is non-enumerating, single-use and revokes every session', async () => {
  const first = request.agent(app);
  const second = request.agent(app);
  assert.equal((await signIn(first, credentials.email, credentials.password, '/api/v1', '192.0.2.11')).status, 200);
  assert.equal((await signIn(second, credentials.email, credentials.password, '/api/v1', '192.0.2.12')).status, 200);

  const unknown = await request(app).post('/api/v1/auth/password/forgot')
    .send({ email:'unknown@example.test' });
  assert.equal(unknown.status, 202);
  assert.deepEqual(unknown.body, { ok:true });

  const forgot = await request(app).post('/api/v1/auth/password/forgot')
    .send({ email:credentials.email });
  assert.equal(forgot.status, 202);
  assert.equal(deliveries.at(-1).type, 'reset');
  const reset = new URL(forgot.body.resetUrl);
  const token = reset.searchParams.get('token');
  const changed = await request(app).post('/api/v1/auth/password/reset')
    .send({ token, password:'replacement-password' });
  assert.equal(changed.status, 200);
  assert.equal((await request(app).post('/api/v1/auth/password/reset')
    .send({ token, password:'another-password' })).status, 400);
  assert.equal((await first.get('/api/auth/me')).body.user, null);
  assert.equal((await second.get('/api/auth/me')).body.user, null);
  assert.equal((await request(app).post('/api/v1/auth/login').send(credentials)).status, 401);
  assert.equal(
    (await signIn(request.agent(app), credentials.email, 'replacement-password', '/api/v1', '192.0.2.13')).status,
    200,
  );
  // Сброс пароля обнуляет и доверие устройств: иначе укравший пароль вошёл бы
  // со своего уже доверенного браузера вообще без кода.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trusted_devices').get().n, 1);
});

test('session inventory can revoke one session without exposing cookie tokens', async () => {
  const first = request.agent(app);
  const second = request.agent(app);
  const password = 'replacement-password';
  assert.equal((await signIn(first, credentials.email, password, '/api/v1', '192.0.2.21')).status, 200);
  assert.equal((await signIn(second, credentials.email, password, '/api/v1', '192.0.2.22')).status, 200);
  const inventory = await first.get('/api/v1/auth/sessions');
  assert.equal(inventory.status, 200);
  assert.ok(inventory.body.sessions.length >= 2);
  assert.equal(inventory.body.sessions.filter(item => item.current).length, 1);
  assert.ok(inventory.body.sessions.every(item => /^[a-f0-9]{64}$/.test(item.id)));
  const other = inventory.body.sessions.find(item => !item.current);
  assert.equal((await first.delete(`/api/v1/auth/sessions/${other.id}`)).status, 204);
  assert.equal((await second.get('/api/auth/me')).body.user, null);
  assert.ok((await first.get('/api/auth/me')).body.user);
});

test('an SMTP outage degrades delivery without breaking signup or leaking accounts', async () => {
  const blocked = new Error('connect ETIMEDOUT 201.24.125.152:465');
  blocked.code = 'ETIMEDOUT';
  outage = blocked;
  try {
    const stranded = { ...credentials, email:'stranded@example.test' };
    const registration = await request(app).post('/api/v1/auth/register').send(stranded);
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    assert.equal(registration.body.emailSent, false);
    assert.ok(registration.body.verificationUrl, 'токен выпущен, письмо только не доставлено');

    // Отказ почты не должен превращаться в оракул существования аккаунта.
    const known = await request(app).post('/api/v1/auth/password/forgot')
      .send({ email:credentials.email });
    const unknown = await request(app).post('/api/v1/auth/password/forgot')
      .send({ email:'nobody@example.test' });
    assert.equal(known.status, unknown.status);
    assert.equal(known.status, 202);
    assert.deepEqual(unknown.body, { ok:true });

    const readiness = await request(app).get('/health/ready');
    assert.equal(readiness.status, 200, 'недоступный SMTP не выводит инстанс из балансировки');
    assert.equal(readiness.body.checks.email, 'degraded');

    assert.ok(db.prepare(
      "SELECT 1 FROM security_events WHERE event_type='email_delivery_failed' LIMIT 1",
    ).get(), 'сбой доставки попадает в журнал безопасности');

    outage = null;
    const resent = await request(app).post('/api/v1/auth/email/resend')
      .send({ email:stranded.email });
    assert.equal(resent.status, 202);
    assert.equal(deliveries.at(-1).to, stranded.email);
    const link = new URL(resent.body.verificationUrl);
    assert.equal((await request(app).get(link.pathname + link.search)).headers.location,
      '/login.html?verified=1&mode=signin');
    assert.equal(
      (await signIn(request.agent(app), stranded.email, stranded.password, '/api/v1', '192.0.2.31'))
        .status,
      200,
    );
  } finally {
    outage = null;
  }
});

test('login code is single-use, attempt-capped and lets a trusted device skip it', async () => {
  const agent = request.agent(app);
  const password = 'replacement-password';
  const started = await agent.post('/api/v1/auth/login')
    .set('X-Forwarded-For', '192.0.2.41').send({ email:credentials.email, password });
  assert.equal(started.status, 202);
  assert.equal(started.body.codeRequired, true);
  assert.equal(started.body.emailHint, 'l***e@example.test', 'адрес не раскрывается целиком');
  assert.equal(deliveries.at(-1).type, 'login');
  assert.match(started.body.code, /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  assert.equal((await agent.get('/api/auth/me')).body.user, null, 'пароль сам по себе не пускает');

  // Регистр и разделители пользователь набирает как придётся.
  const messy = started.body.code.toLowerCase().replace(/-/g, ' ');
  const entered = await agent.post('/api/v1/auth/login/code')
    .send({ challenge:started.body.challenge, code:messy });
  assert.equal(entered.status, 200, JSON.stringify(entered.body));
  assert.ok((await agent.get('/api/auth/me')).body.user);

  // Тот же код второй раз уже не работает.
  assert.equal((await request(app).post('/api/v1/auth/login/code')
    .send({ challenge:started.body.challenge, code:started.body.code })).status, 400);

  // Устройство запомнено: код больше не спрашивают.
  const repeat = await agent.post('/api/v1/auth/login')
    .set('X-Forwarded-For', '192.0.2.41').send({ email:credentials.email, password });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.codeRequired, undefined);

  // Чужой браузер того же пользователя код всё равно получает.
  const stranger = await request.agent(app).post('/api/v1/auth/login')
    .set('X-Forwarded-For', '192.0.2.42').send({ email:credentials.email, password });
  assert.equal(stranger.status, 202);
  assert.equal(stranger.body.codeRequired, true);
});

test('a wrong code is burned after five attempts', async () => {
  const agent = request.agent(app);
  const started = await agent.post('/api/v1/auth/login').set('X-Forwarded-For', '192.0.2.51')
    .send({ email:credentials.email, password:'replacement-password' });
  assert.equal(started.status, 202);
  const wrong = started.body.code === 'AAA-AAA-AAA' ? 'BBB-BBB-BBB' : 'AAA-AAA-AAA';

  const left = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await agent.post('/api/v1/auth/login/code')
      .send({ challenge:started.body.challenge, code:wrong });
    assert.equal(response.status, 400);
    left.push(response.body.attemptsLeft);
  }
  assert.deepEqual(left, [4, 3, 2, 1, undefined], 'счётчик убывает, пятая попытка сжигает код');

  // Даже верный код после исчерпания попыток уже не принимается.
  const afterBurn = await agent.post('/api/v1/auth/login/code')
    .send({ challenge:started.body.challenge, code:started.body.code });
  assert.equal(afterBurn.status, 400);
  assert.equal((await agent.get('/api/auth/me')).body.user, null);
  assert.ok(db.prepare(
    "SELECT 1 FROM security_events WHERE event_type='code_attempts_exhausted' LIMIT 1",
  ).get());
});
