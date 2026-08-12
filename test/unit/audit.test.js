const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceOf } = require('../../server/audit.js');

test('audit resource parser is stable for v1 and legacy routes', () => {
  assert.equal(resourceOf('/api/v1/lessons/lesson-a'), 'lessons');
  assert.equal(resourceOf('/api/attempts/attempt-a/review'), 'attempts');
  assert.equal(resourceOf('/api/v1/profile'), 'profile');
});
