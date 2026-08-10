const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { registerAndLogin } = require('../helpers/auth.js');
const { fixture } = require('../fixtures/scenario.js');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-http-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.TOKEN_DB = path.join(testDir, 'test.db');
process.env.COOKIE_SECURE = 'false';

const { createApp } = require('../../server/app.js');
const { loadConfig } = require('../../server/config.js');
const { db, taskWithAnswer } = require('../../server/db.js');
const { createCore } = require('../../shared/core.js');

const app = createApp({ config: loadConfig() });

test.after(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('liveness and readiness expose request correlation', async () => {
  const live = await request(app)
    .get('/health/live')
    .set('X-Request-Id', 'integration-live');
  assert.equal(live.status, 200);
  assert.equal(live.headers['x-request-id'], 'integration-live');
  assert.deepEqual(live.body, { status: 'ok' });

  const ready = await request(app).get('/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body, { status: 'ready', checks: { database: 'ok', email: 'ok' } });
  assert.match(ready.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('guest cannot receive cabinet markup', async () => {
  const response = await request(app).get('/index.html?subject=inf');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login.html?next=index.html%3Fsubject%3Dinf');
});

test('student session cannot execute tutor commands or see reference answers', async () => {
  const student = request.agent(app);
  await registerAndLogin(student, {
    ...fixture.student,
  });

  const tasks = await student.get('/api/tasks');
  assert.equal(tasks.status, 200);
  assert.ok(tasks.body.length > 0);
  assert.equal(tasks.body.some(task => Object.hasOwn(task, 'answer')), false);

  const state = await student.get('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.tasks.some(task => Object.hasOwn(task, 'answer')), false);

  const forbidden = await student.post('/api/groups').send({
    subjectId: 'inf', title: 'Чужая операция', capacity: 5,
  });
  assert.equal(forbidden.status, 403);
});

test('main learning flow works through public API', async () => {
  const tutor = request.agent(app);
  const student = request.agent(app);
  const otherTutor = request.agent(app);
  const otherStudent = request.agent(app);

  await registerAndLogin(tutor, {
    name: 'Сквозной Репетитор',
    email: 'flow-tutor@example.test',
    password: 'test-password',
    role: 'tutor',
    subjects: ['inf'],
  });

  await registerAndLogin(student, {
    name: 'Сквозной Ученик',
    email: 'flow-student@example.test',
    password: 'test-password',
    role: 'student',
    grade: 11,
  });

  await registerAndLogin(otherTutor, {
    name: 'Другой Репетитор',
    email: 'other-tutor@example.test',
    password: 'test-password',
    role: 'tutor',
    subjects: ['inf'],
  });

  await registerAndLogin(otherStudent, {
    name: 'Другой Ученик',
    email: 'other-student@example.test',
    password: 'test-password',
    role: 'student',
    grade: 11,
  });

  const invite = await tutor.post('/api/invites').send({
    ...fixture.individualRelationship,
  });
  assert.equal(invite.status, 200);

  const accepted = await student.post('/api/invites/accept').send({
    code: invite.body.invite.code,
  });
  assert.equal(accepted.status, 200);

  const tutorState = await tutor.get('/api/state');
  assert.equal(tutorState.status, 200);
  const enrollment = tutorState.body.enrollments.find(item => item.subjectId === 'inf');
  assert.ok(enrollment);

  const lesson = await tutor.post('/api/lessons').send({
    enrollmentId: enrollment.id,
    startsAt: new Date(Date.now() + fixture.lesson.startsInMs).toISOString(),
    durationMin: fixture.lesson.durationMin,
  });
  assert.equal(lesson.status, 200, JSON.stringify(lesson.body));

  const tasks = await tutor.get(`/api/tasks?subject=${fixture.taskSelection.subjectId}`);
  const publicTask = tasks.body.find(item => item.autoCheck === fixture.taskSelection.autoCheck);
  assert.ok(publicTask);
  assert.equal(Object.hasOwn(publicTask, 'answer'), false);

  const attached = await tutor.post(`/api/lessons/${lesson.body.id}/tasks`).send({
    taskId: publicTask.id,
  });
  assert.equal(attached.status, 200);

  const studentState = await student.get('/api/state');
  const attempt = studentState.body.attempts.find(item =>
    item.lessonId === lesson.body.id && item.taskId === publicTask.id);
  assert.ok(attempt);

  const foreignAttempt = await otherStudent
    .post(`/api/attempts/${attempt.id}/progress`)
    .send({ code: 'stolen', activeSeconds: 10 });
  assert.equal(foreignAttempt.status, 403);

  const foreignLesson = await otherTutor
    .post(`/api/lessons/${lesson.body.id}/links`)
    .send({ type: 'material', url: 'https://example.test/private' });
  assert.equal(foreignLesson.status, 403);

  const group = await tutor.post('/api/groups').send({
    subjectId: 'inf', title: 'Группа владельца', capacity: 5,
  });
  assert.equal(group.status, 200);
  const foreignGroup = await otherTutor.post('/api/invites').send({
    kind: 'group', groupId: group.body.id, maxUses: 1,
  });
  assert.equal(foreignGroup.status, 403);

  const hiddenTask = taskWithAnswer(publicTask.id);
  const incorrect = await student.post(`/api/attempts/${attempt.id}/answer`).send({
    answer: `${hiddenTask.answer}__неверно`,
    activeSeconds: 21,
  });
  assert.equal(incorrect.status, 200);
  assert.equal(incorrect.body.correct, false);
  assert.equal(incorrect.body.tries, 1);
  const stateAfterError = (await student.get('/api/state')).body;
  const failedAttempt = stateAfterError.attempts.find(item => item.id === attempt.id);
  assert.equal(failedAttempt.status, 'in_progress');
  assert.equal(failedAttempt.isCorrect, false);
  assert.equal(createCore(stateAfterError).kpi(enrollment.studentId, publicTask.subjectId).accuracy, 0);

  const checked = await student.post(`/api/attempts/${attempt.id}/answer`).send({
    answer: hiddenTask.answer,
    activeSeconds: 42,
  });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.correct, true);
  assert.equal(checked.body.tries, 2);

  const finalState = await student.get('/api/state');
  const finalAttempt = finalState.body.attempts.find(item => item.id === attempt.id);
  assert.equal(finalAttempt.status, 'checked');
  assert.equal(finalAttempt.isCorrect, true);
  assert.equal(finalAttempt.activeSeconds, 42);

  const completed = await tutor.post(`/api/lessons/${lesson.body.id}/status`).send({
    status: 'done',
  });
  assert.equal(completed.status, 200);
  const persistedLesson = db.prepare('SELECT status, version FROM lessons WHERE id = ?').get(lesson.body.id);
  assert.equal(persistedLesson.status, 'done');
  assert.equal(persistedLesson.version, 3);

  const invalidReopen = await tutor.post(`/api/lessons/${lesson.body.id}/status`).send({
    status: 'planned',
  });
  assert.equal(invalidReopen.status, 400);
  assert.match(invalidReopen.body.error, /Недопустимый переход Lesson/);
});

test('invalid JSON has a generic response without stack trace', async () => {
  const response = await request(app)
    .post('/api/tasks/import')
    .set('Content-Type', 'application/json')
    .send('{broken-json');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Некорректный JSON');
  assert.equal(typeof response.body.requestId, 'string');
  assert.equal(JSON.stringify(response.body).includes('SyntaxError'), false);
  assert.equal(JSON.stringify(response.body).includes('server/app.js'), false);
});
