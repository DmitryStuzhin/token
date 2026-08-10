const assert = require('node:assert/strict');

async function registerAndLogin(agent, data, prefix = '/api') {
  const registration = await agent.post(`${prefix}/auth/register`).send(data);
  assert.equal(registration.status, 201, JSON.stringify(registration.body));
  assert.ok(registration.body.verificationUrl, 'test registration must expose verificationUrl');
  const verification = await agent.get(new URL(registration.body.verificationUrl).pathname
    + new URL(registration.body.verificationUrl).search);
  assert.equal(verification.status, 302);
  const login = await agent.post(`${prefix}/auth/login`).send({
    email:data.email,
    password:data.password,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { registration, verification, login };
}

module.exports = { registerAndLogin };
