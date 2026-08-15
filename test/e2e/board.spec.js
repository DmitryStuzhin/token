const { test, expect } = require('@playwright/test');
const { fixture, withUniqueEmail } = require('../fixtures/scenario.js');

const key = () => `board-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const post = (request, path, data) =>
  request.post(path, { data, headers: { 'Idempotency-Key': key() } });

async function register(request, user, prefix) {
  const data = withUniqueEmail(user, prefix);
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const registration = await request.post('/api/v1/auth/register', { data });
  expect(registration.ok()).toBeTruthy();
  const url = new URL((await registration.json()).verificationUrl);
  expect((await request.get(url.pathname + url.search)).ok()).toBeTruthy();
  const started = await request.post('/api/v1/auth/login', {
    data: { email: data.email, password: data.password },
    headers: { 'X-Forwarded-For': ip },
  });
  const challenge = await started.json();
  expect(
    (
      await request.post('/api/v1/auth/login/code', {
        data: { challenge: challenge.challenge, code: challenge.code },
        headers: { 'X-Forwarded-For': ip },
      })
    ).ok(),
  ).toBeTruthy();
}

/** Настоящее рисование мышью: тест обязан ходить теми же путями, что человек. */
async function draw(page, from, to) {
  // Радиокнопка инструмента перекрыта своей иконкой — кликаем принудительно.
  await page.locator('[data-testid="toolbar-freedraw"]').click({ force: true });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 12,
      from.y + ((to.y - from.y) * step) / 12,
    );
  }
  await page.mouse.up();
}

/** Доска — вкладка рабочей области, рядом с кодом, а не отдельный экран. */
async function openBoard(page) {
  await page.locator('.stage-switch button[data-stage="board"]').click();
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(700);
}

test('lesson board syncs both ways and survives a reload', async ({ browser }) => {
  test.setTimeout(120_000);
  const tutorContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const tutorPage = await tutorContext.newPage();
  const studentPage = await studentContext.newPage();
  const problems = [];
  for (const [role, page] of [['tutor', tutorPage], ['student', studentPage]]) {
    page.on('pageerror', error => problems.push(`${role}: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      // Excalidraw всегда дописывает в источники шрифта свой CDN-фолбэк. Под
      // font-src 'self' он блокируется, но шрифты берутся локальные и текст
      // рисуется — это шум, а не поломка. Всё остальное по CSP — поломка.
      const knownFontNoise = /refused to load the font/i.test(text);
      if (!knownFontNoise && /content security policy|refused to (execute|apply|frame)/i.test(text)) {
        problems.push(`${role} CSP: ${text}`);
      }
    });
  }

  await register(tutorContext.request, fixture.tutor, 'board-tutor');
  await register(studentContext.request, fixture.student, 'board-student');
  const invite = await (
    await post(tutorContext.request, '/api/v1/invites', fixture.individualRelationship)
  ).json();
  expect(
    (await post(studentContext.request, '/api/v1/invites/accept', { code: invite.invite.code })).ok(),
  ).toBeTruthy();
  const tutorState = await (await tutorContext.request.get('/api/v1/screens/lesson')).json();
  const lesson = await (
    await post(tutorContext.request, '/api/v1/lessons', {
      enrollmentId: tutorState.state.enrollments[0].id,
      startsAt: new Date(Date.now() + 60_000).toISOString(),
      durationMin: 60,
    })
  ).json();

  // Доска живёт в карточке задания, поэтому занятию нужна задача и попытка.
  const tasks = await (
    await tutorContext.request.get('/api/v1/tasks?subject=inf&limit=100')
  ).json();
  expect(
    (
      await post(tutorContext.request, `/api/v1/lessons/${lesson.id}/tasks`, {
        taskId: tasks.items[0].id,
      })
    ).ok(),
  ).toBeTruthy();

  await tutorPage.goto(`/lesson.html?lesson=${lesson.id}`);
  await studentPage.goto(`/lesson.html?lesson=${lesson.id}`);
  await openBoard(tutorPage);
  await openBoard(studentPage);

  // Репетитор рисует — ученик видит.
  await draw(tutorPage, { x: 400, y: 300 }, { x: 700, y: 420 });
  await expect
    .poll(() => studentPage.evaluate(() => LessonBoard.count()), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const afterTutor = await studentPage.evaluate(() => LessonBoard.count());

  // Ученик рисует — репетитор видит. Это и есть двусторонность.
  await draw(studentPage, { x: 400, y: 500 }, { x: 650, y: 560 });
  await expect
    .poll(() => tutorPage.evaluate(() => LessonBoard.count()), { timeout: 10_000 })
    .toBeGreaterThan(afterTutor - 1);
  const both = await tutorPage.evaluate(() => LessonBoard.count());
  expect(both).toBeGreaterThanOrEqual(2);

  // Переключение на код и обратно не теряет сцену.
  await studentPage.locator('.stage-switch button[data-stage="code"]').click();
  await expect(studentPage.locator('.code-input')).toBeVisible();
  await openBoard(studentPage);
  expect(await studentPage.evaluate(() => LessonBoard.count())).toBeGreaterThanOrEqual(both);

  // Доска переживает перезагрузку: сцена хранится на сервере, а не в вкладке.
  await studentPage.reload();
  await openBoard(studentPage);
  await expect
    .poll(() => studentPage.evaluate(() => LessonBoard.count()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(both);

  expect(problems).toEqual([]);
});
