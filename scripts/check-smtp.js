/**
 * Диагностика исходящей почты. Запускается там, где живёт приложение:
 *
 *   npm run mail:check                 — только соединение и авторизация
 *   npm run mail:check -- me@mail.ru   — плюс реальное тестовое письмо
 *
 * Скрипт разделяет три разных отказа, которые снаружи выглядят одинаково:
 * закрытый порт (таймаут TCP), неверные учётные данные (EAUTH) и отказ
 * провайдера принять отправителя (5xx на MAIL FROM).
 */
const net = require('node:net');

const { loadConfig } = require('../server/config.js');
const { EmailDelivery } = require('../modules/identity/infrastructure/email-delivery.js');

const TCP_TIMEOUT_MS = 10_000;

function probeTcp(host, port) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const socket = net.connect({ host, port });
    const finish = outcome => {
      socket.destroy();
      resolve({ ...outcome, durationMs: Date.now() - startedAt });
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));
    socket.once('error', error => finish({ ok: false, reason: error.code || error.message }));
  });
}

async function main() {
  const recipient = process.argv[2];
  const config = loadConfig();

  if (!config.smtpHost) {
    console.error('SMTP не настроен: задайте SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM.');
    process.exitCode = 1;
    return;
  }

  console.log(`Сервер:     ${config.smtpHost}:${config.smtpPort} (secure=${config.smtpSecure})`);
  console.log(`Логин:      ${config.smtpUser}`);
  console.log(`Отправитель:${config.emailFrom}`);
  console.log('');

  const tcp = await probeTcp(config.smtpHost, config.smtpPort);
  if (!tcp.ok) {
    console.error(`✗ TCP ${config.smtpPort}: ${tcp.reason} за ${tcp.durationMs} мс`);
    console.error('  Порт закрыт снаружи — это сетевая блокировка, а не проблема приложения.');
    process.exitCode = 1;
    return;
  }
  console.log(`✓ TCP ${config.smtpPort}: соединение за ${tcp.durationMs} мс`);

  const delivery = new EmailDelivery(config, {
    info: (event, fields) => console.log(`  ${event}`, fields),
    warn: (event, fields) => console.warn(`  ${event}`, fields),
    error: (event, fields) => console.error(`  ${event}`, fields),
  });

  try {
    const startedAt = Date.now();
    await delivery.verify();
    console.log(`✓ SMTP AUTH: успешно за ${Date.now() - startedAt} мс`);
  } catch (error) {
    console.error(`✗ SMTP AUTH: ${error.code || 'ошибка'} — ${error.message}`);
    if (error.code === 'EAUTH') {
      console.error('  Логин или пароль неверны. Логин должен совпадать с адресом отправителя.');
    }
    await delivery.close();
    process.exitCode = 1;
    return;
  }

  if (!recipient) {
    console.log('\nТестовое письмо не отправлено: передайте адрес получателя аргументом.');
    await delivery.close();
    return;
  }

  try {
    const link = `${config.publicOrigin || 'http://localhost:' + config.port}/login.html`;
    const info = await delivery.sendVerification(recipient, link);
    console.log(`✓ Письмо принято сервером: ${info.messageId}`);
    console.log(`  accepted: ${(info.accepted || []).join(', ') || '—'}`);
    if ((info.rejected || []).length) console.log(`  rejected: ${info.rejected.join(', ')}`);
  } catch (error) {
    console.error(`✗ Отправка: ${error.code || 'ошибка'} — ${error.message}`);
    if (error.responseCode >= 500) {
      console.error('  Провайдер отклонил письмо: проверьте, что EMAIL_FROM совпадает с SMTP_USER.');
    }
    process.exitCode = 1;
  } finally {
    await delivery.close();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
