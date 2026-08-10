const crypto = require('node:crypto');
const { v7: uuidv7 } = require('uuid');
const argon2 = require('@node-rs/argon2');

const { generateCode, formatCode, normalizeCode } = require('../domain/access-code.js');

const SESSION_DAYS = 30;
const TRUSTED_DEVICE_DAYS = 30;
const MAX_CODE_ATTEMPTS = 5;

const LIFETIMES = {
  verify_email: 24 * 60 * 60_000,
  reset_password: 30 * 60_000,
  // Код входа живёт коротко: он предъявляется сразу, а длинное окно только
  // расширяет промежуток, в котором перехваченное письмо ещё чего-то стоит.
  login_code: 10 * 60_000,
};

const LINK_PATHS = {
  verify_email: '/api/v1/auth/email/verify?token=',
  reset_password: '/login.html?mode=reset&token=',
};

async function hashPassword(password) {
  const hash = await argon2.hash(String(password), {
    algorithm: argon2.Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  return { hash, salt: '' };
}
/**
 * n***@mail.ru — подсказка, какой ящик открывать, без выдачи адреса целиком.
 * Длина звёздочек фиксирована: повторять её по длине имени значит подсказывать
 * эту длину и заодно ломать вёрстку на длинных адресах.
 */
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return '';
  const tail = name.length > 2 ? name.slice(-1) : '';
  return `${name.slice(0, 1)}***${tail}@${domain}`;
}

async function verifyPassword(password, hash, salt) {
  if (String(hash).startsWith('$argon2id$')) return argon2.verify(hash, String(password));
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

class AuthService {
  constructor(store, roles, options = {}) {
    this.store = store;
    this.roles = roles;
    this.email = options.email || {
      async sendVerification() {},
      async sendPasswordReset() {},
      async sendLoginCode() {},
    };
    this.publicOrigin = options.publicOrigin || 'http://localhost:3000';
    this.exposeTokens = options.exposeTokens === true;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
  }
  tokenHash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }
  async security(type, context = {}) {
    if (typeof this.store.recordSecurityEvent !== 'function') return;
    await this.store.recordSecurityEvent({
      id: uuidv7(),
      userId: context.userId || null,
      type,
      occurredAt: new Date().toISOString(),
      ip: String(context.ip || '').slice(0, 100),
      userAgent: String(context.userAgent || '').slice(0, 200),
      metadata: context.metadata || {},
    });
  }
  async issueToken(user, purpose, context = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    // Ссылку получают только сценарии, где переход по ней осмыслен. Код входа
    // ссылкой быть не может: письмо со ссылкой «войти» — это готовый фишинг.
    const withCode = purpose === 'verify_email' || purpose === 'login_code';
    const code = withCode ? generateCode() : null;
    const created = new Date();
    const lifetime = LIFETIMES[purpose];
    await this.store.replaceAccountToken({
      tokenHash: this.tokenHash(token),
      userId: user.id,
      purpose,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + lifetime).toISOString(),
      ip: String(context.ip || '').slice(0, 100),
      codeHash: code ? this.tokenHash(code) : null,
    });
    const path = LINK_PATHS[purpose];
    const link = path ? `${this.publicOrigin}${path}${encodeURIComponent(token)}` : null;
    // Токен уже сохранён. Падение SMTP не должно ни ломать регистрацию, ни
    // отличать существующий адрес от несуществующего в восстановлении пароля —
    // поэтому ошибка доставки только логируется и попадает в журнал безопасности.
    let delivered = true;
    try {
      if (purpose === 'verify_email')
        await this.email.sendVerification(user.email, link, formatCode(code));
      else if (purpose === 'login_code')
        await this.email.sendLoginCode(user.email, formatCode(code), context);
      else await this.email.sendPasswordReset(user.email, link);
    } catch (error) {
      delivered = false;
      this.logger.error('email_delivery_failed', {
        purpose,
        userId: user.id,
        code: error.code || null,
        error: error.message,
      });
      await this.security('email_delivery_failed', {
        ...context,
        userId: user.id,
        metadata: { purpose, code: error.code || null },
      });
    }
    return {
      delivered,
      handle: token,
      ...(this.exposeTokens ? { token, link, code: code ? formatCode(code) : null } : {}),
    };
  }
  /**
   * Сравнение кода. Постоянное время нужно не столько против тайминг-атаки
   * (пять попыток всё равно не дадут её провести), сколько чтобы неудачная
   * ветка не отличалась от удачной вообще ничем.
   */
  matchesCode(storedHash, input) {
    if (!storedHash) return false;
    const actual = Buffer.from(this.tokenHash(normalizeCode(input)), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  /**
   * Проверка кода с учётом попыток. Исчерпав лимит, строка удаляется целиком:
   * это дешевле блокировки аккаунта и не даёт запереть чужой вход спамом.
   */
  async redeemCode(row, purpose, code, context) {
    if (!row) return { error: 'Код недействителен или истёк' };
    if (!this.matchesCode(row.code_hash, code)) {
      const attempts = await this.store.countAccountTokenAttempt(row.token_hash);
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.store.deleteAccountToken(row.token_hash);
        await this.security('code_attempts_exhausted', { ...context, userId: row.user_id });
        return { error: 'Слишком много попыток. Запросите новый код' };
      }
      return { error: 'Неверный код', attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
    }
    const consumed = await this.store.consumeAccountToken(
      row.token_hash,
      purpose,
      new Date().toISOString(),
    );
    if (!consumed) return { error: 'Код недействителен или истёк' };
    return { userId: consumed };
  }
  async register(data, context = {}) {
    const name = String(data.name || '').trim();
    const email = String(data.email || '')
      .trim()
      .toLowerCase();
    const password = String(data.password || '');
    const role = data.role;
    if (name.length < 2) return { error: 'Укажите имя и фамилию' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { error: 'Похоже, email введён с ошибкой' };
    if (password.length < 10) return { error: 'Пароль — минимум 10 символов' };
    if (!this.roles[role]) return { error: 'Выберите роль' };
    if (!this.roles[role].enabled)
      return { error: `Роль «${this.roles[role].label}» пока недоступна` };
    if (await this.store.emailExists(email)) return { error: 'Такой email уже зарегистрирован' };
    const { hash, salt } = await hashPassword(password);
    const createdAt = new Date().toISOString();
    const user = await this.store.createUser({
      id: uuidv7(),
      profileId: uuidv7(),
      role,
      name,
      email,
      hash,
      salt,
      phone: String(data.phone || ''),
      tz: String(data.tz || 'Europe/Moscow'),
      createdAt,
      grade: Number(data.grade) || 11,
      school: String(data.school || ''),
      subjects: Array.isArray(data.subjects) && data.subjects.length ? data.subjects : ['inf'],
      yearsExp: Number(data.yearsExp) || 1,
      rate: Number(data.rate) || 0,
      meetingUrl: String(data.meetingUrl || ''),
    });
    const delivery = await this.issueToken(user, 'verify_email', context);
    await this.security('account_registered', { ...context, userId: user.id });
    return { user, verificationRequired: true, ...delivery };
  }
  async login(email, password, context = {}) {
    const user = await this.store.findUserByEmail(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
    if (!user) {
      await this.security('login_failed', { ...context, metadata: { reason: 'unknown_email' } });
      return { error: 'Неверный email или пароль' };
    }
    if (!(await verifyPassword(password, user.pass_hash, user.pass_salt))) {
      await this.security('login_failed', {
        ...context,
        userId: user.id,
        metadata: { reason: 'password' },
      });
      return { error: 'Неверный email или пароль' };
    }
    if (!user.email_verified_at) {
      await this.security('login_blocked_unverified', { ...context, userId: user.id });
      return { error: 'Подтвердите email перед входом', code: 'EMAIL_UNVERIFIED' };
    }
    if (!String(user.pass_hash).startsWith('$argon2id$')) {
      const upgraded = await hashPassword(password);
      await this.store.updatePassword(user.id, upgraded);
    }
    // Пароль сошёлся. Дальше решаем, нужен ли второй фактор: на уже доверенном
    // устройстве код спрашивать незачем, иначе ученик перед каждым занятием
    // лезет в почту.
    if (context.deviceToken) {
      const trusted = await this.store.touchTrustedDevice(
        user.id,
        this.tokenHash(context.deviceToken),
        new Date().toISOString(),
      );
      if (trusted) {
        await this.security('login_succeeded', {
          ...context,
          userId: user.id,
          metadata: { factor: 'trusted_device' },
        });
        return { user };
      }
    }
    const delivery = await this.issueToken(user, 'login_code', context);
    await this.security('login_code_requested', { ...context, userId: user.id });
    return {
      codeRequired: true,
      challenge: delivery.handle,
      emailHint: maskEmail(user.email),
      delivered: delivery.delivered,
      ...(this.exposeTokens ? { code: delivery.code } : {}),
    };
  }
  /**
   * Второй шаг входа. Пароль здесь уже не спрашивается: право продолжить даёт
   * challenge, выданный за верный пароль, а код доказывает владение почтой.
   */
  async completeLogin(challenge, code, context = {}) {
    const now = new Date().toISOString();
    const row = await this.store.findAccountToken(
      { tokenHash: this.tokenHash(String(challenge || '')), purpose: 'login_code' },
      now,
    );
    const redeemed = await this.redeemCode(row, 'login_code', code, context);
    if (redeemed.error) {
      await this.security('login_code_failed', {
        ...context,
        userId: row ? row.user_id : null,
        metadata: { reason: redeemed.error },
      });
      return redeemed;
    }
    const user = await this.store.findUserById(redeemed.userId);
    if (!user) return { error: 'Код недействителен или истёк' };
    const device = await this.trustDevice(user.id, context);
    await this.security('login_succeeded', {
      ...context,
      userId: user.id,
      metadata: { factor: 'email_code' },
    });
    return { user, deviceToken: device.token, deviceExpires: device.expires };
  }
  async resendLoginCode(challenge, context = {}) {
    const now = new Date().toISOString();
    const row = await this.store.findAccountToken(
      { tokenHash: this.tokenHash(String(challenge || '')), purpose: 'login_code' },
      now,
    );
    if (!row) return { error: 'Сессия входа истекла. Введите email и пароль заново' };
    const user = await this.store.findUserById(row.user_id);
    if (!user) return { error: 'Сессия входа истекла. Введите email и пароль заново' };
    const delivery = await this.issueToken(user, 'login_code', context);
    await this.security('login_code_resent', { ...context, userId: user.id });
    return {
      ok: true,
      challenge: delivery.handle,
      delivered: delivery.delivered,
      ...(this.exposeTokens ? { code: delivery.code } : {}),
    };
  }
  async trustDevice(userId, context = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const created = new Date();
    const expires = new Date(created.getTime() + TRUSTED_DEVICE_DAYS * 86400000);
    await this.store.createTrustedDevice({
      id: uuidv7(),
      userId,
      tokenHash: this.tokenHash(token),
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
      userAgent: String(context.userAgent || '').slice(0, 200),
    });
    return { token, expires };
  }
  async resendVerification(email, context = {}) {
    const user = await this.store.findUserByEmail(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
    if (!user || user.email_verified_at) return { ok: true };
    const delivery = await this.issueToken(user, 'verify_email', context);
    await this.security('verification_resent', { ...context, userId: user.id });
    return { ok: true, ...delivery };
  }
  async verifyEmail(token, context = {}) {
    const now = new Date().toISOString();
    const userId = await this.store.consumeAccountToken(this.tokenHash(token), 'verify_email', now);
    if (!userId) return { error: 'Ссылка подтверждения недействительна или истекла' };
    await this.store.markEmailVerified(userId, now);
    await this.security('email_verified', { ...context, userId });
    return { ok: true };
  }
  /**
   * Подтверждение регистрации кодом. Адрес нужен, чтобы найти аккаунт: письмо
   * могли открыть на другом устройстве, где handle из ответа регистрации
   * недоступен.
   */
  async verifyEmailCode(email, code, context = {}) {
    const now = new Date().toISOString();
    const user = await this.store.findUserByEmail(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
    if (!user) return { error: 'Код недействителен или истёк' };
    if (user.email_verified_at) return { ok: true, alreadyVerified: true };
    const row = await this.store.findAccountToken(
      { userId: user.id, purpose: 'verify_email' },
      now,
    );
    const redeemed = await this.redeemCode(row, 'verify_email', code, context);
    if (redeemed.error) {
      await this.security('email_verification_code_failed', {
        ...context,
        userId: user.id,
        metadata: { reason: redeemed.error },
      });
      return redeemed;
    }
    await this.store.markEmailVerified(redeemed.userId, now);
    await this.security('email_verified', {
      ...context,
      userId: redeemed.userId,
      metadata: { via: 'code' },
    });
    return { ok: true };
  }
  async requestPasswordReset(email, context = {}) {
    const user = await this.store.findUserByEmail(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
    if (!user || !user.email_verified_at) return { ok: true };
    const delivery = await this.issueToken(user, 'reset_password', context);
    await this.security('password_reset_requested', { ...context, userId: user.id });
    return { ok: true, ...delivery };
  }
  async resetPassword(token, password, context = {}) {
    if (String(password || '').length < 10) return { error: 'Пароль — минимум 10 символов' };
    const now = new Date().toISOString();
    const userId = await this.store.consumeAccountToken(
      this.tokenHash(token),
      'reset_password',
      now,
    );
    if (!userId) return { error: 'Ссылка восстановления недействительна или истекла' };
    await this.store.updatePassword(userId, await hashPassword(password));
    await this.store.deleteSessionsForUser(userId);
    // Сброс пароля — это заявление «доступ мог быть скомпрометирован». Тогда и
    // доверие устройств должно обнулиться, иначе тот, кто увёл пароль, спокойно
    // войдёт со своего уже доверенного браузера вообще без кода.
    await this.store.deleteTrustedDevicesForUser(userId);
    await this.security('password_reset_completed', { ...context, userId });
    return { ok: true };
  }
  async createSession(userId, userAgent) {
    const token = crypto.randomBytes(32).toString('hex');
    const created = new Date();
    const expires = new Date(created.getTime() + SESSION_DAYS * 86400000);
    await this.store.createSession({
      token,
      userId,
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
      userAgent: String(userAgent || '').slice(0, 200),
    });
    return { token, expires };
  }
  async destroySession(token) {
    await this.store.deleteSession(token);
  }
  async sessions(userId, currentToken) {
    return this.store.listSessions(userId, currentToken);
  }
  async revokeSession(userId, sessionId) {
    return this.store.deleteSessionById(userId, sessionId);
  }
  async revokeOtherSessions(userId, currentToken) {
    return this.store.deleteSessionsForUser(userId, currentToken);
  }
  async userBySession(token) {
    const session = await this.store.findSession(token);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await this.destroySession(token);
      return null;
    }
    return this.store.findUserById(session.user_id);
  }
  async profileOf(user) {
    return user ? this.store.profileOf(user) : null;
  }
  async ready() {
    await this.store.ready();
  }
}

module.exports = { AuthService, hashPassword, verifyPassword };
