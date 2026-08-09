const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../../server/config.js');

test('configuration applies safe test defaults', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 3000);
  assert.equal(config.cookieSecure, false);
  assert.equal(config.logLevel, 'silent');
  assert.equal(config.sqlMetrics, false);
  assert.equal(config.databaseDriver, 'sqlite');
});

test('production cookies are secure by default', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://token:secret@127.0.0.1:5432/token',
  });
  assert.equal(config.cookieSecure, true);
  assert.equal(config.databaseDriver, 'postgres');
});

test('invalid configuration fails during startup', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'invalid' }), /NODE_ENV/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', PORT: 'zero' }), /PORT/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'yes' }), /COOKIE_SECURE/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', SQL_METRICS: '1' }), /SQL_METRICS/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL/);
});
