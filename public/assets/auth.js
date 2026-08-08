/* ═══════════════════════════════════════════════════════════════════
   СЕССИЯ НА КЛИЕНТЕ

   Настоящая проверка прав живёт на сервере: он не отдаст ни чужих
   данных, ни разметки кабинета неавторизованному гостю. Здесь только
   удобство — понять, кто вошёл, и не рисовать чужой экран.
   ═══════════════════════════════════════════════════════════════════ */
window.Auth = (function () {
  const state = window.__STATE__ || {};

  const ROLES = {
    student: { label:'Ученик',    home:'/index.html', enabled:true,
               hint:'Занятия, домашние задания, статистика' },
    tutor:   { label:'Репетитор', home:'/tutor.html', enabled:true,
               hint:'Ученики, группы, проверка работ, ведение занятий' },
    parent:  { label:'Родитель',  home:'/parent.html', enabled:false,
               hint:'Прогресс ребёнка и оплата — скоро' },
  };

  const current = () => state.me || null;

  function session() {
    const u = current();
    if (!u) return null;
    const sp = (state.studentProfiles || []).find(p => p.userId === u.id);
    const tp = (state.tutorProfiles || []).find(p => p.userId === u.id);
    return {
      user: u, role: u.role,
      profile: u.role === 'student' ? sp || null : u.role === 'tutor' ? tp || null : null,
      studentId: u.role === 'student' && sp ? sp.id : null,
      tutorId: u.role === 'tutor' && tp ? tp.id : null,
      home: ROLES[u.role].home,
    };
  }

  function require(roles) {
    const s = session();
    if (!s) {
      location.href = '/login.html?next=' +
        encodeURIComponent(location.pathname.replace(/^\//, '') + location.search);
      return null;
    }
    const list = Array.isArray(roles) ? roles : roles ? [roles] : null;
    if (list && !list.includes(s.role)) { location.href = s.home; return null; }
    return s;
  }

  async function logout() {
    try { await Api.logout(); } catch (e) {}
    location.href = '/login.html';
  }

  return { ROLES, current, session, require, logout };
})();
