const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-api-v1-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'sqlite';
process.env.LOG_LEVEL = 'silent';
process.env.TOKEN_DB = path.join(testDir, 'test.db');
process.env.COOKIE_SECURE = 'false';

const { createApp } = require('../../server/app.js');
const { loadConfig } = require('../../server/config.js');
const { db } = require('../../server/db.js');

const app = createApp({ config: loadConfig() });

test.after(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('API v1 provides screen DTO, pagination, ETag and Problem Details', async () => {
  const guestScreen = await request(app).get('/api/v1/screens/login');
  assert.equal(guestScreen.status, 200);
  assert.equal(guestScreen.body.screen, 'login');
  assert.ok(Array.isArray(guestScreen.body.state.subjects));
  assert.equal(Object.hasOwn(guestScreen.body.state, 'tasks'), false);

  const tutor = request.agent(app);
  const registration = await tutor.post('/api/v1/auth/register').send({
    name: 'API V1 Репетитор',
    email: 'api-v1-tutor@example.test',
    password: 'test-password',
    role: 'tutor',
    subjects: ['inf'],
  });
  assert.equal(registration.status, 200);

  const me = await tutor.get('/api/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'tutor');
  assert.match(me.headers.etag, /^"[^"]+"$/);
  const unchanged = await tutor.get('/api/v1/me').set('If-None-Match', me.headers.etag);
  assert.equal(unchanged.status, 304);

  const invalid = await tutor.post('/api/v1/groups').send({ subjectId: 'inf' });
  assert.equal(invalid.status, 422);
  assert.match(invalid.headers['content-type'], /application\/problem\+json/);
  assert.equal(invalid.body.status, 422);
  assert.equal(Array.isArray(invalid.body.errors), true);

  const missingKey = await tutor.post('/api/v1/groups').send({
    subjectId: 'inf', title: 'API v1 группа', capacity: 5,
  });
  assert.equal(missingKey.status, 400);

  const key = 'api-v1-contract-key';
  const created = await tutor.post('/api/v1/groups').set('Idempotency-Key', key).send({
    subjectId: 'inf', title: 'API v1 группа', capacity: 5,
  });
  assert.equal(created.status, 200);
  const replayed = await tutor.post('/api/v1/groups').set('Idempotency-Key', key).send({
    subjectId: 'inf', title: 'API v1 группа', capacity: 5,
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers['idempotency-replayed'], 'true');
  assert.equal(replayed.body.id, created.body.id);

  const lessonCreated = await tutor
    .post('/api/v1/lessons')
    .set('Idempotency-Key', 'api-v1-lesson-key')
    .send({
      enrollmentId: null,
      groupId: created.body.id,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      durationMin: 60,
    });
  assert.equal(lessonCreated.status, 200);
  const lesson = await tutor.get(`/api/v1/lessons/${lessonCreated.body.id}`);
  assert.equal(lesson.status, 200);
  assert.equal(lesson.headers.etag, '"v1"');
  const missingVersion = await tutor
    .patch(`/api/v1/lessons/${lessonCreated.body.id}`)
    .send({ status:'done' });
  assert.equal(missingVersion.status, 428);
  const changed = await tutor
    .patch(`/api/v1/lessons/${lessonCreated.body.id}`)
    .set('If-Match', lesson.headers.etag)
    .send({ status:'done' });
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.etag, '"v2"');
  const stale = await tutor
    .patch(`/api/v1/lessons/${lessonCreated.body.id}`)
    .set('If-Match', lesson.headers.etag)
    .send({ status:'cancelled' });
  assert.equal(stale.status, 412);

  const conflicting = await tutor.post('/api/v1/groups').set('Idempotency-Key', key).send({
    subjectId: 'inf', title: 'Другая группа', capacity: 5,
  });
  assert.equal(conflicting.status, 409);

  const firstPage = await tutor.get('/api/v1/tasks?limit=2&sort=number&order=asc');
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.items.length, 2);
  assert.equal(firstPage.body.page.hasMore, true);
  assert.equal(firstPage.body.items.some(item => Object.hasOwn(item, 'answer')), false);
  const secondPage = await tutor.get(
    `/api/v1/tasks?limit=2&sort=number&order=asc&cursor=${encodeURIComponent(firstPage.body.page.nextCursor)}`,
  );
  assert.equal(secondPage.status, 200);
  assert.notEqual(secondPage.body.items[0].id, firstPage.body.items[0].id);

  const screen = await tutor.get('/api/v1/screens/bank');
  const legacy = await tutor.get('/api/state');
  assert.ok(Buffer.byteLength(JSON.stringify(screen.body.state)) < Buffer.byteLength(JSON.stringify(legacy.body)));
  assert.equal(screen.body.state.tasks.some(item => Object.hasOwn(item, 'answer')), false);
});
