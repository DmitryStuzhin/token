/* ═══════════════════════════════════════════════════════════════════
   АВТОРИЗАЦИЯ НА СЕРВЕРЕ

   Пароль солится и хешируется scrypt (встроенный crypto, без внешних
   зависимостей). Сессия — случайный токен в таблице sessions и
   httpOnly-кука: клиентский JavaScript её не читает и подделать
   сессию не может.
   ═══════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { db, one } = require('./db.js');

const COOKIE = 'token_sid';
const SESSION_DAYS = 30;

const ROLES = {
  student: { label:'Ученик',    home:'/index.html',  enabled:true },
  tutor:   { label:'Репетитор', home:'/tutor.html',  enabled:true },
  parent:  { label:'Родитель',  home:'/parent.html', enabled:false },
};

const uid = p => p + '-' + crypto.randomBytes(8).toString('hex');

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { hash: h, salt: s };
}

function verifyPassword(password, hash, salt) {
  const h = crypto.scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === h.length && crypto.timingSafeEqual(known, h);
}

/* ── регистрация ─────────────────────────────────────────────────── */
function register(data) {
  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  const role = data.role;

  if (name.length < 2) return { error:'Укажите имя и фамилию' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error:'Похоже, email введён с ошибкой' };
  if (password.length < 4) return { error:'Пароль — минимум 4 символа' };
  if (!ROLES[role]) return { error:'Выберите роль' };
  if (!ROLES[role].enabled) return { error:`Роль «${ROLES[role].label}» пока недоступна` };
  if (one('SELECT id FROM users WHERE email = ?', email)) return { error:'Такой email уже зарегистрирован' };

  const { hash, salt } = hashPassword(password);
  const id = uid('u');
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`INSERT INTO users (id,role,name,email,pass_hash,pass_salt,phone,tz,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, role, name, email, hash, salt, String(data.phone || ''), String(data.tz || 'Europe/Moscow'), now);

    if (role === 'student') {
      db.prepare('INSERT INTO student_profiles (id,user_id,grade,school,started_at) VALUES (?,?,?,?,?)')
        .run(uid('s'), id, +data.grade || 11, String(data.school || ''), now.slice(0, 10));
      const pref = db.prepare('INSERT INTO notification_prefs (user_id,channel,enabled,handle,minutes_before) VALUES (?,?,?,?,?)');
      pref.run(id, 'telegram', 0, '', null);
      pref.run(id, 'email', 1, email, null);
      pref.run(id, 'lesson_reminder', 1, '', 60);
      pref.run(id, 'hw_deadline', 1, '', 1440);
    } else if (role === 'tutor') {
      const subjects = Array.isArray(data.subjects) && data.subjects.length ? data.subjects : ['inf'];
      db.prepare('INSERT INTO tutor_profiles (id,user_id,subjects,years_exp,rate,meeting_url) VALUES (?,?,?,?,?,?)')
        .run(uid('tp'), id, JSON.stringify(subjects), +data.yearsExp || 1, +data.rate || 0, String(data.meetingUrl || ''));
    }
  })();

  return { user: one('SELECT * FROM users WHERE id = ?', id) };
}

/* ── вход и сессии ───────────────────────────────────────────────── */
function login(email, password) {
  const u = one('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  if (!u) return { error:'Пользователь с таким email не найден' };
  if (!verifyPassword(password, u.pass_hash, u.pass_salt)) return { error:'Неверный пароль' };
  return { user: u };
}

function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare('INSERT INTO sessions (token,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)')
    .run(token, userId, now.toISOString(), exp.toISOString(), String(userAgent || '').slice(0, 200));
  return { token, expires: exp };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userBySession(token) {
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token = ?', token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) { destroySession(token); return null; }
  return one('SELECT * FROM users WHERE id = ?', s.user_id) || null;
}

/* профиль, соответствующий роли */
function profileOf(user) {
  if (!user) return null;
  if (user.role === 'student') return one('SELECT * FROM student_profiles WHERE user_id = ?', user.id);
  if (user.role === 'tutor') return one('SELECT * FROM tutor_profiles WHERE user_id = ?', user.id);
  return null;
}

/* ── middleware ──────────────────────────────────────────────────── */
function attach(req, res, next) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  req.sessionToken = m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  req.user = userBySession(req.sessionToken);
  if (req.user) {
    const p = profileOf(req.user);
    req.profile = p || null;
    req.studentId = req.user.role === 'student' && p ? p.id : null;
    req.tutorId = req.user.role === 'tutor' && p ? p.id : null;
  }
  next();
}

function setCookie(res, token, expires) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    expires, secure: false,          /* локальный http; за TLS-прокси включить true */
  });
}
const clearCookie = res => res.clearCookie(COOKIE, { path: '/' });

/* требуем вход и, опционально, конкретную роль */
const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error:'Нужно войти' });

const requireRole = role => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error:'Нужно войти' });
  if (req.user.role !== role) return res.status(403).json({ error:'Недостаточно прав' });
  if (role === 'tutor' && !req.tutorId) return res.status(403).json({ error:'Профиль репетитора не найден' });
  if (role === 'student' && !req.studentId) return res.status(403).json({ error:'Профиль ученика не найден' });
  next();
};

module.exports = { ROLES, COOKIE, uid, register, login, createSession, destroySession,
                   userBySession, profileOf, attach, setCookie, clearCookie,
                   requireUser, requireRole, hashPassword, verifyPassword };
