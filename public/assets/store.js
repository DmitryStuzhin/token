/* ═══════════════════════════════════════════════════════════════════
   СНИМОК СОСТОЯНИЯ НА КЛИЕНТЕ

   Данные приходят из специализированного /api/v1/screens/{screen}.js,
   поэтому страница стартует синхронно и без мигания пустым экраном.
   Здесь только чтение: любое изменение уходит на сервер через Api.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const state = window.__STATE__ || {};

  /* пустые коллекции, чтобы выборки не спотыкались о undefined */
  ['subjects','topics','tasks','users','studentProfiles','tutorProfiles','guardians',
   'enrollments','groups','groupMembers','invites','goals','subscriptions',
   'notificationPrefs','lessons','lessonAttendance','assignments','mockExams','attempts']
    .forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });

  window.Core = window.createCore(state);

  /* перечитать состояние с сервера без перезагрузки страницы */
  window.Store = {
    state,
    async refresh() {
      const screen = window.__SCREEN__ || 'index';
      const r = await fetch('/api/v1/screens/' + encodeURIComponent(screen), {
        credentials:'same-origin', headers:{ Accept:'application/json' },
      });
      if (!r.ok) throw new Error('Не удалось обновить данные');
      const fresh = (await r.json()).state;
      Object.keys(fresh).forEach(k => { state[k] = fresh[k]; });
      window.Core = window.createCore(state);
      return state;
    },
  };
})();
