const assert = require('node:assert/strict');

/**
 * Полный путь новичка: регистрация → подтверждение ссылкой → вход паролем →
 * код из письма. Тестовый runtime отдаёт код и ссылку прямо в ответе, поэтому
 * помощник не читает почту.
 */
async function registerAndLogin(agent, data, prefix = '/api') {
  const registration = await agent.post(`${prefix}/auth/register`).send({
    consents: { personal_data: '2026-08-13', terms: '2026-08-13' },
    ...data,
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  assert.ok(registration.body.verificationUrl, 'test registration must expose verificationUrl');
  const url = new URL(registration.body.verificationUrl);
  const verification = await agent.get(url.pathname + url.search);
  assert.equal(verification.status, 302);
  const login = await signIn(agent, data.email, data.password, prefix);
  return { registration, verification, login };
}

/**
 * Вход с прохождением второго фактора. Возвращает финальный ответ входа.
 * `ip` разносит запросы по адресам: вход ограничен пятью попытками на адрес,
 * а один тест логинится многократно.
 */
async function signIn(agent, email, password, prefix = '/api', ip = null) {
  const withIp = (request) => (ip ? request.set('X-Forwarded-For', ip) : request);
  const started = await withIp(agent.post(`${prefix}/auth/login`)).send({ email, password });
  if (started.status === 200) return started;
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.codeRequired, true);
  assert.ok(started.body.code, 'test login must expose the emailed code');
  const completed = await withIp(agent.post(`${prefix}/auth/login/code`)).send({
    challenge: started.body.challenge,
    code: started.body.code,
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  return completed;
}

module.exports = { registerAndLogin, signIn };
