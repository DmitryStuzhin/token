const crypto = require('node:crypto');
const { v7: uuidv7 } = require('uuid');
const argon2 = require('@node-rs/argon2');

const SESSION_DAYS = 30;

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
    const created = new Date();
    const lifetime = purpose === 'verify_email' ? 24 * 60 * 60_000 : 30 * 60_000;
    await this.store.replaceAccountToken({
      tokenHash: this.tokenHash(token),
      userId: user.id,
      purpose,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + lifetime).toISOString(),
      ip: String(context.ip || '').slice(0, 100),
    });
    const path =
      purpose === 'verify_email'
        ? '/api/v1/auth/email/verify?token='
        : '/login.html?mode=reset&token=';
    const link = `${this.publicOrigin}${path}${encodeURIComponent(token)}`;
    // Токен уже сохранён. Падение SMTP не должно ни ломать регистрацию, ни
    // отличать существующий адрес от несуществующего в восстановлении пароля —
    // поэтому ошибка доставки только логируется и попадает в журнал безопасности.
    let delivered = true;
    try {
      if (purpose === 'verify_email') await this.email.sendVerification(user.email, link);
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
    return { delivered, ...(this.exposeTokens ? { token, link } : {}) };
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
    await this.security('login_succeeded', { ...context, userId: user.id });
    return { user };
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
