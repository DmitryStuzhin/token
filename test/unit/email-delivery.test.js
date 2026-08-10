const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { EmailDelivery, isRetryable } = require('../../modules/identity/infrastructure/email-delivery.js');

const silent = { info() {}, warn() {}, error() {} };
const baseConfig = { nodeEnv:'test', emailFrom:'Token <noreply@tokenapp.ru>' };

function withTransport(transport, options = {}) {
  const delivery = new EmailDelivery(baseConfig, silent, options);
  delivery.transport = transport;
  return delivery;
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function smtpError(code, responseCode) {
  const error = new Error(`SMTP ${code}`);
  error.code = code;
  if (responseCode) error.responseCode = responseCode;
  return error;
}

test('transient SMTP failures are retried, permanent ones are not', async () => {
  let attempts = 0;
  const flaky = withTransport({
    async sendMail() {
      attempts += 1;
      if (attempts < 3) throw smtpError('ETIMEDOUT');
      return { messageId:'<ok@token>', accepted:['a@b.test'] };
    },
  });
  const info = await flaky.sendVerification('a@b.test', 'https://tokenapp.ru/verify');
  assert.equal(info.messageId, '<ok@token>');
  assert.equal(attempts, 3);

  let authAttempts = 0;
  const rejected = withTransport({
    async sendMail() {
      authAttempts += 1;
      throw smtpError('EAUTH', 535);
    },
  });
  await assert.rejects(() => rejected.sendPasswordReset('a@b.test', 'https://tokenapp.ru/reset'),
    /SMTP EAUTH/);
  assert.equal(authAttempts, 1, 'неверные учётные данные не повторяем');

  assert.equal(isRetryable(smtpError('ECONNECTION')), true);
  assert.equal(isRetryable(smtpError('EMESSAGE', 451)), true);
  assert.equal(isRetryable(smtpError('EENVELOPE', 550)), false);
});

test('letters carry both plain text and HTML with the link intact', async () => {
  const sent = [];
  const delivery = withTransport({
    async sendMail(message) { sent.push(message); return { messageId:'<x@token>' }; },
  });
  const link = 'https://tokenapp.ru/api/v1/auth/email/verify?token=abc&x=1';
  await delivery.sendVerification('student@example.test', link);
  const [message] = sent;
  assert.equal(message.from, baseConfig.emailFrom);
  assert.ok(message.text.includes(link));
  assert.ok(message.html.includes('&amp;x=1'), 'ссылка в HTML должна быть экранирована');
  assert.ok(!/<script/i.test(message.html));
  assert.ok(message.headers['X-Entity-Ref-ID']);
});

test('a hanging SMTP handshake fails fast instead of blocking the probe', async () => {
  const delivery = withTransport({ verify: () => new Promise(() => {}) }, { verifyTimeoutMs:150 });
  const started = Date.now();
  await assert.rejects(() => delivery.verify(), /превышено ожидание/);
  assert.ok(Date.now() - started < 2_000);
});

test('a rejected login is cached, so readiness cannot flood the provider with AUTH', async () => {
  let attempts = 0;
  const rejecting = withTransport({
    async verify() {
      attempts += 1;
      const error = new Error('Invalid login: 535 Incorrect authentication data');
      error.responseCode = 535;
      throw error;
    },
    async sendMail() {
      return { messageId:'<recovered@token>' };
    },
  });

  // Readiness-проба ходит раз в несколько секунд: за это окно провайдер должен
  // увидеть ровно одну попытку, иначе он заблокирует адрес по потоку 535.
  for (let probe = 0; probe < 10; probe += 1) {
    await assert.rejects(() => rejecting.verify(), /535/);
  }
  assert.equal(attempts, 1);

  // Удачная отправка сильнее закешированного отказа.
  await rejecting.sendPasswordReset('a@b.test', 'https://tokenapp.ru/reset');
  assert.deepEqual(await rejecting.verify(), { cached:true });
  assert.equal(attempts, 1);

  const expiring = withTransport({ async verify() { attempts += 1; } }, { checkCacheMs:1 });
  await expiring.verify();
  await sleep(5);
  await expiring.verify();
  assert.equal(attempts, 3, 'по истечении окна проверка повторяется');
});

test('without SMTP configured non-production delivery is a no-op', async () => {
  const delivery = new EmailDelivery({ nodeEnv:'test' }, silent);
  const result = await delivery.sendVerification('a@b.test', 'https://tokenapp.ru/verify');
  assert.equal(result.preview, true);
  await assert.rejects(
    () => new EmailDelivery({ nodeEnv:'production' }, silent).sendVerification('a@b.test', 'x'),
    /не настроена/,
  );
});
