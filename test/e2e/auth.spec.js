const { test, expect } = require('@playwright/test');
const { fixture, withUniqueEmail } = require('../fixtures/scenario.js');

/** Ответ тестового окружения содержит код письма — читаем его из сети. */
function captureJson(page, path) {
  return page.waitForResponse(response =>
    response.url().includes(path) && response.request().method() === 'POST');
}

async function submitVerifyAndLogin(page, user) {
  await page.locator('#f-consent-data').check();
  await page.locator('#f-consent-terms').check();
  const registrationResponse = captureJson(page, '/api/v1/auth/register');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  const registration = await (await registrationResponse).json();

  // Регистрация приводит на шаг ввода кода, а не на «проверьте почту».
  await expect(page.getByRole('heading', { name: 'Подтвердите email' })).toBeVisible();
  await page.locator('#f-code').fill(registration.code);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('#out')).toContainText('Email подтверждён');

  await page.locator('#f-email').fill(user.email);
  await page.locator('#f-pass').fill(user.password);
  const loginResponse = captureJson(page, '/api/v1/auth/login');
  await page.getByRole('button', { name: 'Войти' }).click();
  const login = await (await loginResponse).json();

  await expect(page.getByRole('heading', { name: 'Код для входа' })).toBeVisible();
  await page.locator('#f-code').fill(login.code);
  await page.getByRole('button', { name: 'Продолжить' }).click();
}

test('guest is redirected to login and can register as tutor', async ({ page }) => {
  await page.goto('/tutor.html');
  await expect(page).toHaveURL(/\/login\.html\?next=tutor\.html/);
  await expect(page.getByText('Подготовка к экзамену с репетитором')).toBeVisible();

  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.locator('[data-role="tutor"]').click();

  const tutor = withUniqueEmail(fixture.tutor, 'browser');
  await page.locator('#f-name').fill(tutor.name);
  await page.locator('#f-email').fill(tutor.email);
  await page.locator('#f-pass').fill(tutor.password);
  await submitVerifyAndLogin(page, tutor);

  await expect(page).toHaveURL(/\/tutor\.html$/);
  await expect(page.getByRole('heading', { name: /Сегодня/ })).toBeVisible();
  await expect(page.getByText(tutor.name)).toBeVisible();
});

test('student registration opens an empty but actionable cabinet', async ({ page }) => {
  await page.goto('/login.html');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.locator('[data-role="student"]').click();

  const student = withUniqueEmail(fixture.student, 'browser');
  await page.locator('#f-name').fill(student.name);
  await page.locator('#f-email').fill(student.email);
  await page.locator('#f-pass').fill(student.password);
  await submitVerifyAndLogin(page, student);

  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.getByRole('heading', { name: 'Присоединитесь к репетитору' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Присоединиться' })).toBeVisible();
  await expect(page.getByText(student.name)).toBeVisible();
});

test('frontend screens use API v1 bootstrap and never request legacy state', async ({ page }) => {
  const requests = [];
  const pageErrors = [];
  const cspErrors = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (/content security policy|refused to (execute|apply|load|frame)/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });

  await page.goto('/login.html');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.locator('[data-role="tutor"]').click();
  const tutor = withUniqueEmail(fixture.tutor, 'api-v1-browser');
  await page.locator('#f-name').fill(tutor.name);
  await page.locator('#f-email').fill(tutor.email);
  await page.locator('#f-pass').fill(tutor.password);
  await submitVerifyAndLogin(page, tutor);
  await expect(page).toHaveURL(/\/tutor\.html$/);

  for (const screen of ['students', 'groups', 'invites', 'bank', 'tutor-check', 'tutor']) {
    await page.goto(`/${screen}.html`);
    await expect(page.locator('body')).toBeVisible();
  }

  expect(requests.some(path => path === '/api/state' || path === '/api/state.js')).toBe(false);
  for (const screen of ['login', 'students', 'groups', 'invites', 'bank', 'tutor-check', 'tutor']) {
    expect(requests).toContain(`/api/v1/screens/${screen}.js`);
  }
  expect(pageErrors).toEqual([]);
  expect(cspErrors).toEqual([]);
});
