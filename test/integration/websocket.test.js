const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { registerAndLogin } = require('../helpers/auth.js');
const WebSocket = require('ws');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-ws-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.TOKEN_DB = path.join(testDir, 'test.db');
process.env.COOKIE_SECURE = 'false';

const { createApp } = require('../../server/app.js');
const { loadConfig } = require('../../server/config.js');
const { db } = require('../../server/db.js');
const live = require('../../server/live.js');
const { fixture } = require('../fixtures/scenario.js');

const app = createApp({ config: loadConfig() });
const server = http.createServer(app);
app.locals.live = live.create(server, {
  auth: app.locals.auth,
  repository: app.locals.repository,
});

function cookieOf(response) {
  return response.headers['set-cookie'][0].split(';')[0];
}

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket message timeout')), timeoutMs);
    function onMessage(raw) {
      const message = JSON.parse(String(raw));
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.off('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

function expectRejected(url, cookie, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie } });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('Unauthorized WebSocket was not rejected'));
    }, timeoutMs);
    ws.once('open', () => {
      clearTimeout(timeout);
      ws.terminate();
      reject(new Error('Unauthorized WebSocket opened'));
    });
    const rejected = () => {
      clearTimeout(timeout);
      resolve();
    };
    ws.once('error', rejected);
    ws.once('close', rejected);
  });
}

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('lesson room authorizes participants and delivers draft, coaching, laser and hint safely', async () => {
  const tutor = request.agent(app);
  const student = request.agent(app);
  const outsider = request.agent(app);
  const outsiderTutor = request.agent(app);

  const tutorRegistration = (await registerAndLogin(tutor, {
    ...fixture.tutor,
    email: 'ws-tutor@example.test',
  })).login;
  const studentRegistration = (await registerAndLogin(student, {
    ...fixture.student,
    email: 'ws-student@example.test',
  })).login;
  const outsiderRegistration = (await registerAndLogin(outsider, {
    ...fixture.secondStudent,
    email: 'ws-outsider@example.test',
  })).login;
  await registerAndLogin(outsiderTutor, {
    ...fixture.tutor,
    email: 'ws-outsider-tutor@example.test',
  });
  const invite = await tutor.post('/api/invites').send({
    ...fixture.individualRelationship,
  });
  assert.equal(
    (
      await student.post('/api/invites/accept').send({
        code: invite.body.invite.code,
      })
    ).status,
    200,
  );

  const tutorState = await tutor.get('/api/state');
  const enrollment = tutorState.body.enrollments[0];
  const lesson = await tutor.post('/api/lessons').send({
    enrollmentId: enrollment.id,
    startsAt: new Date(Date.now() + fixture.lesson.startsInMs).toISOString(),
    durationMin: fixture.lesson.durationMin,
  });
  const tasks = await tutor.get(`/api/tasks?subject=${fixture.taskSelection.subjectId}`);
  const taskItem = tasks.body.find((item) => item.autoCheck === fixture.taskSelection.autoCheck);
  assert.equal(
    (
      await tutor.post(`/api/lessons/${lesson.body.id}/tasks`).send({
        taskId: taskItem.id,
      })
    ).status,
    200,
  );

  const studentState = await student.get('/api/state');
  const attempt = studentState.body.attempts.find((item) => item.lessonId === lesson.body.id);
  assert.ok(attempt);

  const address = server.address();
  const wsUrl = `ws://127.0.0.1:${address.port}/live?lesson=${lesson.body.id}`;
  const tutorWs = new WebSocket(wsUrl, { headers: { Cookie: cookieOf(tutorRegistration) } });
  const studentWs = new WebSocket(wsUrl, { headers: { Cookie: cookieOf(studentRegistration) } });
  await Promise.all([
    new Promise((resolve, reject) => {
      tutorWs.once('open', resolve).once('error', reject);
    }),
    new Promise((resolve, reject) => {
      studentWs.once('open', resolve).once('error', reject);
    }),
  ]);

  const liveStudentCode = waitForMessage(
    tutorWs,
    (message) => message.type === 'code_live' && message.attemptId === attempt.id,
  );
  studentWs.send(
    JSON.stringify({ type: 'code_live', attemptId: attempt.id, code: 'typing-now', sequence: 1 }),
  );
  assert.equal((await liveStudentCode).code, 'typing-now');

  const liveTutorCode = waitForMessage(
    studentWs,
    (message) => message.type === 'code_live' && message.attemptId === attempt.id,
  );
  tutorWs.send(
    JSON.stringify({ type: 'code_live', attemptId: attempt.id, code: 'coach-now', sequence: 2 }),
  );
  assert.equal((await liveTutorCode).code, 'coach-now');

  const draftMessage = waitForMessage(
    tutorWs,
    (message) =>
      message.type === 'snapshot' &&
      message.attempts.some((item) => item.id === attempt.id && item.code === 'live-code'),
  );

  const progress = await student.post(`/api/attempts/${attempt.id}/progress`).send({
    code: 'live-code',
    activeSeconds: 15,
  });
  assert.equal(progress.status, 200);
  const delivered = await draftMessage;
  assert.equal(delivered.lessonId, lesson.body.id);

  const coachedMessage = waitForMessage(
    studentWs,
    (message) =>
      message.type === 'snapshot' &&
      message.attempts.some((item) => item.id === attempt.id && item.code === 'coached-code'),
  );
  const coached = await tutor
    .post(`/api/attempts/${attempt.id}/coach`)
    .send({ code: 'coached-code' });
  assert.equal(coached.status, 200);
  await coachedMessage;
  assert.equal(
    (await student.post(`/api/attempts/${attempt.id}/coach`).send({ code: 'forbidden' })).status,
    403,
  );
  assert.equal(
    (await outsiderTutor.post(`/api/attempts/${attempt.id}/coach`).send({ code: 'forbidden' }))
      .status,
    403,
  );

  const afterCoach = await student.get('/api/state');
  const coachedAttempt = afterCoach.body.attempts.find((item) => item.id === attempt.id);
  assert.equal(coachedAttempt.code, 'coached-code');
  assert.equal(coachedAttempt.activeSeconds, 15, 'coaching must not inflate active time');
  assert.equal(coachedAttempt.tries, 0, 'coaching must not create answer tries');
  assert.equal(coachedAttempt.isCorrect, null, 'coaching must not change correctness');

  const laserStart = waitForMessage(studentWs, (message) => message.type === 'laser_start');
  tutorWs.send(
    JSON.stringify({
      type: 'laser_start',
      strokeId: 'stroke-1',
      studentId: coachedAttempt.studentId,
      taskId: taskItem.id,
      points: [{ x: 0.1, y: 0.2 }],
    }),
  );
  assert.deepEqual((await laserStart).points, [{ x: 0.1, y: 0.2 }]);
  const laserPoints = waitForMessage(studentWs, (message) => message.type === 'laser_points');
  tutorWs.send(
    JSON.stringify({ type: 'laser_points', strokeId: 'stroke-1', points: [{ x: 0.5, y: 0.7 }] }),
  );
  assert.deepEqual((await laserPoints).points, [{ x: 0.5, y: 0.7 }]);
  const laserEnd = waitForMessage(studentWs, (message) => message.type === 'laser_end');
  tutorWs.send(JSON.stringify({ type: 'laser_end', strokeId: 'stroke-1' }));
  assert.equal((await laserEnd).strokeId, 'stroke-1');

  const secondTask = tasks.body.find((item) => item.id !== taskItem.id);
  const invalidated = waitForMessage(
    studentWs,
    (message) => message.type === 'state_invalidated' && message.reason === 'tasks_changed',
  );
  assert.equal(
    (
      await tutor.post(`/api/lessons/${lesson.body.id}/tasks`).send({ taskId: secondTask.id })
    ).status,
    200,
  );
  assert.equal((await invalidated).lessonId, lesson.body.id);

  const hintMessage = waitForMessage(studentWs, (message) => message.type === 'hint');
  tutorWs.send(
    JSON.stringify({
      type: 'hint',
      studentId: coachedAttempt.studentId,
      taskId: taskItem.id,
      line: 2,
      text: 'Проверь границу цикла',
    }),
  );
  const hint = await hintMessage;
  assert.equal(hint.line, 2);
  assert.equal(hint.text, 'Проверь границу цикла');

  await expectRejected(wsUrl, cookieOf(outsiderRegistration));

  tutorWs.close();
  studentWs.close();
});
