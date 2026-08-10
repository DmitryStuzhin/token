const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

/**
 * Сеть до SMTP-провайдера — самая ненадёжная часть регистрации. Таймауты
 * заданы явно: у nodemailer значения по умолчанию измеряются минутами, и на
 * заблокированном порту любой запрос с отправкой письма зависал бы целиком.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;
const VERIFY_TIMEOUT_MS = 12_000;
const CHECK_CACHE_MS = 60_000;
const SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

/** Сетевые сбои и временные отказы SMTP (4xx) — повторяем. EAUTH и 5xx — нет. */
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNECTION',
  'ECONNRESET',
  'ECONNREFUSED',
  'ESOCKET',
  'EDNS',
  'EPIPE',
]);

function isRetryable(error) {
  if (!error) return false;
  if (RETRYABLE_CODES.has(error.code)) return true;
  return (
    Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode < 500
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}: превышено ожидание ${ms} мс`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

/** Письма читают и в тексте, и в HTML: без text/plain часть фильтров режет рейтинг. */
function layout({ heading, intro, action, link, footer }) {
  const text = `${heading}\n\n${intro}\n\n${link}\n\n${footer}\n\nЕсли вы не запрашивали это письмо, просто удалите его.`;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#f5f6f8;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1d22">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px"><tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
<p style="margin:0 0 24px">${escapeHtml(intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1c1d22;color:#fff;text-decoration:none">${escapeHtml(action)}</a></p>
<p style="margin:0 0 24px;font-size:13px;color:#6b6d76">Если кнопка не открывается, скопируйте ссылку:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
<p style="margin:0;font-size:13px;color:#6b6d76">${escapeHtml(footer)} Если вы не запрашивали это письмо, просто удалите его.</p>
</td></tr></table></body></html>`;
  return { text, html };
}

class EmailDelivery {
  constructor(config, logger, options = {}) {
    this.config = config;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.verifyTimeoutMs = options.verifyTimeoutMs || VERIFY_TIMEOUT_MS;
    this.checkCacheMs = options.checkCacheMs || CHECK_CACHE_MS;
    this.verifiedAt = null;
    this.checkedAt = null;
    this.lastError = null;
    this.transport = config.smtpHost
      ? nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          // На 587 письмо не должно уходить, если STARTTLS не поднялся.
          requireTLS: !config.smtpSecure,
          auth: { user: config.smtpUser, pass: config.smtpPassword },
          pool: true,
          maxConnections: 2,
          maxMessages: 50,
          rateDelta: 60_000,
          rateLimit: 30,
          connectionTimeout: CONNECTION_TIMEOUT_MS,
          greetingTimeout: GREETING_TIMEOUT_MS,
          socketTimeout: SOCKET_TIMEOUT_MS,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      : null;
  }

  get configured() {
    return this.transport !== null;
  }

  async sendVerification(email, link) {
    return this.send({
      to: email,
      subject: 'Подтвердите email в Token',
      purpose: 'verify_email',
      ...layout({
        heading: 'Подтвердите адрес',
        intro: 'Остался один шаг: подтвердите email, чтобы войти в Token.',
        action: 'Подтвердить email',
        link,
        footer: 'Ссылка действует 24 часа.',
      }),
    });
  }

  async sendPasswordReset(email, link) {
    return this.send({
      to: email,
      subject: 'Восстановление пароля Token',
      purpose: 'reset_password',
      ...layout({
        heading: 'Новый пароль',
        intro: 'Откройте ссылку, чтобы задать новый пароль для входа в Token.',
        action: 'Задать новый пароль',
        link,
        footer: 'Ссылка одноразовая и действует 30 минут.',
      }),
    });
  }

  async send({ to, subject, text, html, purpose }) {
    if (!this.transport) {
      // Продакшен-конфигурация обязана содержать SMTP: loadConfig это проверяет.
      if (this.config.nodeEnv === 'production') throw new Error('Почтовая доставка не настроена');
      this.logger.info('email_skipped', { purpose, reason: 'smtp_not_configured' });
      return { accepted: [to], preview: true };
    }
    const message = {
      from: this.config.emailFrom,
      to,
      subject,
      text,
      html,
      headers: { 'X-Entity-Ref-ID': crypto.randomBytes(12).toString('hex') },
    };
    let lastError = null;
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const info = await this.transport.sendMail(message);
        // Успешная отправка — более сильное доказательство работоспособности,
        // чем verify(): гасим закешированный отказ, чтобы readiness не врал.
        this.verifiedAt = Date.now();
        this.checkedAt = this.verifiedAt;
        this.lastError = null;
        this.logger.info('email_sent', {
          purpose,
          attempt,
          durationMs: Date.now() - startedAt,
          messageId: info.messageId,
          accepted: Array.isArray(info.accepted) ? info.accepted.length : 0,
        });
        return info;
      } catch (error) {
        lastError = error;
        const retry = attempt < SEND_ATTEMPTS && isRetryable(error);
        this.logger.warn('email_send_failed', {
          purpose,
          attempt,
          durationMs: Date.now() - startedAt,
          code: error.code || null,
          responseCode: error.responseCode || null,
          error: error.message,
          willRetry: retry,
        });
        if (!retry) break;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  /**
   * Рукопожатие с SMTP. Кешируется и успех, и отказ: readiness-проба ходит раз
   * в несколько секунд, а полноценный коннект на каждый её вызов провайдер
   * считает флудом. Неудачу кешировать особенно важно — поток неверных AUTH
   * с одного адреса почтовые хостинги блокируют по IP, и тогда починка пароля
   * уже ничего не даст.
   */
  async verify() {
    if (!this.transport) {
      if (this.config.nodeEnv === 'production') throw new Error('Почтовая доставка не настроена');
      return { skipped: true };
    }
    if (this.checkedAt && Date.now() - this.checkedAt < this.checkCacheMs) {
      if (this.lastError) throw this.lastError;
      return { cached: true };
    }
    try {
      await withTimeout(this.transport.verify(), this.verifyTimeoutMs, 'SMTP verify');
      this.checkedAt = Date.now();
      this.lastError = null;
      this.verifiedAt = this.checkedAt;
      return { ok: true };
    } catch (error) {
      this.checkedAt = Date.now();
      this.lastError = error;
      this.verifiedAt = null;
      throw error;
    }
  }

  async close() {
    if (this.transport && typeof this.transport.close === 'function') this.transport.close();
  }
}

module.exports = { EmailDelivery, isRetryable };
