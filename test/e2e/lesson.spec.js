const { test, expect } = require('@playwright/test');
const { fixture, withUniqueEmail } = require('../fixtures/scenario.js');

const key = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function post(request, path, data) {
  return request.post(path, { data, headers: { 'Idempotency-Key': key() } });
}
async function register(request, user, prefix) {
  const response = await request.post('/api/v1/auth/register', {
    data: withUniqueEmail(user, prefix),
  });
  expect(response.ok()).toBeTruthy();
}

test('production lesson keeps roles, realtime editing and statistics consistent', async ({
  browser,
}) => {
  const tutorContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const tutorPage = await tutorContext.newPage();
  const studentPage = await studentContext.newPage();
  const pageErrors = [];
  tutorPage.on('pageerror', (error) => pageErrors.push(`tutor: ${error.message}`));
  studentPage.on('pageerror', (error) => pageErrors.push(`student: ${error.message}`));

  await register(tutorContext.request, fixture.tutor, 'lesson-tutor');
  await register(studentContext.request, fixture.student, 'lesson-student');
  await register(secondContext.request, fixture.secondStudent, 'lesson-student-two');

  const inviteResponse = await post(
    tutorContext.request,
    '/api/v1/invites',
    fixture.individualRelationship,
  );
  const invite = await inviteResponse.json();
  expect(
    (
      await post(studentContext.request, '/api/v1/invites/accept', { code: invite.invite.code })
    ).ok(),
  ).toBeTruthy();
  const tutorState = await (await tutorContext.request.get('/api/v1/screens/lesson')).json();
  const enrollment = tutorState.state.enrollments[0];
  const lessonResponse = await post(tutorContext.request, '/api/v1/lessons', {
    enrollmentId: enrollment.id,
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    durationMin: 60,
  });
  const lesson = await lessonResponse.json();
  const tasks = await (
    await tutorContext.request.get('/api/v1/tasks?subject=inf&limit=100')
  ).json();
  const task = tasks.items.find((item) => item.autoCheck);
  expect(
    (
      await post(tutorContext.request, `/api/v1/lessons/${lesson.id}/tasks`, { taskId: task.id })
    ).ok(),
  ).toBeTruthy();

  await Promise.all([
    tutorPage.goto(`/lesson.html?lesson=${lesson.id}&task=${task.id}`),
    studentPage.goto(`/lesson.html?lesson=${lesson.id}&task=${task.id}`),
  ]);
  await expect(tutorPage.locator('.interactive-editor')).toBeVisible();
  await expect(studentPage.locator('.interactive-editor')).toBeVisible();
  await expect(tutorPage.getByRole('button', { name: 'Лазер' })).toBeVisible();
  await expect(studentPage.getByRole('button', { name: 'Лазер' })).toHaveCount(0);
  await expect(studentPage.locator('.expanded-statement')).toContainText(task.title);

  const studentStateBefore = await (
    await studentContext.request.get('/api/v1/screens/lesson')
  ).json();
  const attemptBefore = studentStateBefore.state.attempts.find(
    (item) => item.lessonId === lesson.id && item.taskId === task.id,
  );
  await tutorPage.locator('.code-input').fill('print(40 + 2)');
  await expect(studentPage.locator('.code-input')).toHaveValue('print(40 + 2)', { timeout: 5_000 });
  await tutorPage.getByRole('button', { name: /Запустить/ }).click();
  // The status changes synchronously before the in-browser Python promise resolves.
  await expect(tutorPage.locator('.editor-status')).not.toContainText('Готово к запуску');
  await expect(tutorPage.locator('.editor-status')).toContainText('42');

  await tutorPage.locator('.code-input').dblclick();
  await tutorPage.locator('.hint-composer textarea').fill('Проверь выражение в этой строке');
  await tutorPage.getByRole('button', { name: 'Отправить ученику' }).click();
  await expect(studentPage.locator('.received-hint')).toContainText(
    'Проверь выражение в этой строке',
  );

  await tutorPage.getByRole('button', { name: 'Лазер' }).click();
  const stage = await tutorPage.locator('.editor-stage').boundingBox();
  await tutorPage.mouse.move(stage.x + 80, stage.y + 70);
  await tutorPage.mouse.down();
  await tutorPage.mouse.move(stage.x + 220, stage.y + 130, { steps: 8 });
  await tutorPage.mouse.up();
  await expect(studentPage.locator('.laser-trail')).toHaveCount(1);

  const studentStateAfter = await (
    await studentContext.request.get('/api/v1/screens/lesson')
  ).json();
  const attemptAfter = studentStateAfter.state.attempts.find(
    (item) => item.id === attemptBefore.id,
  );
  expect(attemptAfter.activeSeconds).toBe(attemptBefore.activeSeconds);
  expect(attemptAfter.tries).toBe(attemptBefore.tries);
  expect(attemptAfter.isCorrect).toBe(attemptBefore.isCorrect);
  await tutorPage.screenshot({ path: '/tmp/token-production-tutor.png', fullPage: true });
  await studentPage.screenshot({ path: '/tmp/token-production-student.png', fullPage: true });
  await studentPage.setViewportSize({ width: 390, height: 844 });
  await studentPage.screenshot({
    path: '/tmp/token-production-student-mobile.png',
    fullPage: true,
  });

  const groupResponse = await post(tutorContext.request, '/api/v1/groups', fixture.group);
  const group = await groupResponse.json();
  const groupInviteResponse = await post(tutorContext.request, '/api/v1/invites', {
    kind: 'group',
    groupId: group.id,
    maxUses: 2,
  });
  const groupInvite = await groupInviteResponse.json();
  expect(
    (
      await post(studentContext.request, '/api/v1/invites/accept', {
        code: groupInvite.invite.code,
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await post(secondContext.request, '/api/v1/invites/accept', { code: groupInvite.invite.code })
    ).ok(),
  ).toBeTruthy();
  const groupLessonResponse = await post(tutorContext.request, '/api/v1/lessons', {
    groupId: group.id,
    startsAt: new Date(Date.now() + 120_000).toISOString(),
    durationMin: 90,
  });
  const groupLesson = await groupLessonResponse.json();
  expect(
    (
      await post(tutorContext.request, `/api/v1/lessons/${groupLesson.id}/tasks`, {
        taskId: task.id,
      })
    ).ok(),
  ).toBeTruthy();
  await tutorPage.goto(`/lesson.html?lesson=${groupLesson.id}&task=${task.id}`);
  await expect(tutorPage.locator('.runtime-heat .heat-row:not(.head)')).toHaveCount(2);
  await tutorPage.locator('.runtime-heat .cell').first().click();
  await expect(tutorPage.locator('.student-focus-overlay')).toBeVisible();
  await expect(tutorPage.locator('.student-focus-overlay .expanded-statement')).toContainText(
    task.title,
  );
  await expect(tutorPage.locator('.student-focus-overlay .interactive-editor')).toBeVisible();
  await tutorPage.screenshot({ path: '/tmp/token-production-group-focus.png', fullPage: true });

  expect(pageErrors).toEqual([]);
  await Promise.all([tutorContext.close(), studentContext.close(), secondContext.close()]);
});
