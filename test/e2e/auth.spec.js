const { test, expect } = require('@playwright/test');
const { fixture, withUniqueEmail } = require('../fixtures/scenario.js');

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
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

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
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.getByRole('heading', { name: 'Присоединитесь к репетитору' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Присоединиться' })).toBeVisible();
  await expect(page.getByText(student.name)).toBeVisible();
});

test('frontend screens use API v1 bootstrap and never request legacy state', async ({ page }) => {
  const requests = [];
  const pageErrors = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login.html');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.locator('[data-role="tutor"]').click();
  const tutor = withUniqueEmail(fixture.tutor, 'api-v1-browser');
  await page.locator('#f-name').fill(tutor.name);
  await page.locator('#f-email').fill(tutor.email);
  await page.locator('#f-pass').fill(tutor.password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
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
});
