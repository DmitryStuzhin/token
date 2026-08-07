/* ═══════════════════════════════════════════════════════════════════
   АВТОРИЗАЦИЯ И РОЛИ

   Роль выбирается при регистрации и определяет весь кабинет:
   ученик и репетитор видят разные экраны, разные данные и разные права.
   Родитель заведён как роль, но пока закрыт заглушкой.

   Пароль здесь хешируется примитивной функцией и лежит в localStorage —
   этого достаточно, чтобы показать разделение ролей, и категорически
   недостаточно для боевой версии: там пароль проверяется на сервере,
   хеш считается bcrypt/argon2, сессия живёт в httpOnly-куке.
   ═══════════════════════════════════════════════════════════════════ */
window.Auth = (function () {
  const db = DB.load();

  const ROLES = {
    student: { label:'Ученик',    home:'index.html', enabled:true,
               hint:'Занятия, домашние задания, статистика' },
    tutor:   { label:'Репетитор', home:'tutor.html', enabled:true,
               hint:'Ученики, группы, проверка работ, ведение занятий' },
    parent:  { label:'Родитель',  home:'parent.html', enabled:false,
               hint:'Прогресс ребёнка и оплата — скоро' },
  };

  /* примитивный хеш: только чтобы не хранить пароль как есть */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  const norm = e => String(e || '').trim().toLowerCase();
  const byEmail = email => db.users.find(u => norm(u.email) === norm(email)) || null;
  const byId = id => db.users.find(u => u.id === id) || null;

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /* ── регистрация ─────────────────────────────────────────────── */
  function register(data) {
    const name = String(data.name || '').trim();
    const email = norm(data.email);
    const password = String(data.password || '');
    const role = data.role;

    if (name.length < 2) return { ok:false, error:'Укажите имя и фамилию' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok:false, error:'Похоже, email введён с ошибкой' };
    if (password.length < 4) return { ok:false, error:'Пароль — минимум 4 символа' };
    if (!ROLES[role]) return { ok:false, error:'Выберите роль' };
    if (!ROLES[role].enabled) return { ok:false, error:`Роль «${ROLES[role].label}» пока недоступна` };
    if (byEmail(email)) return { ok:false, error:'Такой email уже зарегистрирован' };

    const user = {
      id: uid('u'), role, name, email,
      phone: String(data.phone || '').trim(),
      pass: hash(password),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);

    if (role === 'student') {
      db.studentProfiles.push({
        id: uid('s'), userId: user.id,
        grade: +data.grade || 11, school: String(data.school || '').trim(),
        startedAt: new Date().toISOString().slice(0, 10),
      });
      db.notificationPrefs.push(
        { userId:user.id, channel:'telegram', enabled:false, handle:'' },
        { userId:user.id, channel:'email', enabled:true, handle:email },
        { userId:user.id, channel:'lesson_reminder', enabled:true, minutesBefore:60 },
        { userId:user.id, channel:'hw_deadline', enabled:true, minutesBefore:1440 });
    } else if (role === 'tutor') {
      db.tutorProfiles.push({
        id: uid('tp'), userId: user.id,
        subjects: Array.isArray(data.subjects) && data.subjects.length ? data.subjects : ['inf'],
        yearsExp: +data.yearsExp || 1,
        rate: +data.rate || 0,
        meetingUrl: String(data.meetingUrl || '').trim(),
      });
    }

    db.session = { userId: user.id, since: new Date().toISOString() };
    DB.save();
    return { ok:true, user };
  }

  /* ── вход и выход ────────────────────────────────────────────── */
  function login(email, password) {
    const u = byEmail(email);
    if (!u) return { ok:false, error:'Пользователь с таким email не найден' };
    if (u.pass !== hash(String(password || ''))) return { ok:false, error:'Неверный пароль' };
    db.session = { userId: u.id, since: new Date().toISOString() };
    DB.save();
    return { ok:true, user:u };
  }

  /* быстрый вход без пароля — только для прототипа на своём устройстве */
  function loginAs(userId) {
    const u = byId(userId);
    if (!u) return { ok:false, error:'Аккаунт не найден' };
    db.session = { userId: u.id, since: new Date().toISOString() };
    DB.save();
    return { ok:true, user:u };
  }

  function logout() {
    db.session = null;
    DB.save();
    location.href = 'login.html';
  }

  function current() {
    if (!db.session) return null;
    return byId(db.session.userId);
  }

  /* профиль, соответствующий роли */
  function profile(user) {
    const u = user || current();
    if (!u) return null;
    if (u.role === 'student') return db.studentProfiles.find(p => p.userId === u.id) || null;
    if (u.role === 'tutor') return db.tutorProfiles.find(p => p.userId === u.id) || null;
    return null;
  }

  /* полный контекст страницы: кто вошёл, какой у него профиль */
  function session() {
    const u = current();
    if (!u) return null;
    const p = profile(u);
    return {
      user: u, role: u.role, profile: p,
      studentId: u.role === 'student' && p ? p.id : null,
      tutorId: u.role === 'tutor' && p ? p.id : null,
      home: ROLES[u.role].home,
    };
  }

  /* защита страницы: не тот, кто нужен — уводим куда положено */
  function require(roles) {
    const s = session();
    if (!s) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search); return null; }
    const list = Array.isArray(roles) ? roles : roles ? [roles] : null;
    if (list && !list.includes(s.role)) { location.href = s.home; return null; }
    return s;
  }

  const accounts = () => db.users.map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role }));
  const isEmpty = () => db.users.length === 0;

  return { ROLES, register, login, loginAs, logout, current, profile, session,
           require, accounts, isEmpty, byEmail };
})();
