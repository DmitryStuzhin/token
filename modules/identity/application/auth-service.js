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
  constructor(store, roles) {
    this.store = store;
    this.roles = roles;
  }
  async register(data) {
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
    return { user };
  }
  async login(email, password) {
    const user = await this.store.findUserByEmail(
      String(email || '')
        .trim()
        .toLowerCase(),
    );
    if (!user) return { error: 'Пользователь с таким email не найден' };
    if (!(await verifyPassword(password, user.pass_hash, user.pass_salt)))
      return { error: 'Неверный пароль' };
    if (!String(user.pass_hash).startsWith('$argon2id$')) {
      const upgraded = await hashPassword(password);
      await this.store.updatePassword(user.id, upgraded);
    }
    return { user };
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
