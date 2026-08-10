(function () {
  const ses = Auth.require('student');
  if (!ses) return;
  const C = Core;
  const S = ses.studentId;
  const me = C.studentUser(S);
  const prof = C.student(S);
  const subjects = C.subjectsOf(S);
  const groups = C.groupsOf(S);
  const sub = C.subscriptionOf(S);
  const guards = C.db.guardians.filter(g => g.studentId === S);

  const PREFS = [
    { channel:'telegram',        label:'Telegram',           hint: p => p.handle || 'не привязан' },
    { channel:'email',           label:'Email',              hint: () => 'дайджест раз в неделю' },
    { channel:'lesson_reminder', label:'Напомнить о занятии',hint: p => 'за ' + Math.round((p.minutesBefore||60)/60) + ' ч' },
    { channel:'hw_deadline',     label:'Дедлайн по д/з',     hint: () => 'за день до сдачи' },
  ];

  function prefsHTML() {
    return PREFS.map(x => {
      const p = C.db.notificationPrefs.find(n => n.userId === me.id && n.channel === x.channel) || {};
      return `<label class="toggle">
        <span class="lbl">${x.label}<small>${UI.esc(x.hint(p))}</small></span>
        <span class="sw"><input type="checkbox" data-ch="${x.channel}" ${p.enabled ? 'checked' : ''}><i></i></span>
      </label>`;
    }).join('');
  }

  const body = `
    <div class="cols c2">
      <div class="stack">
        <section class="card">
          <div class="head"><div><h2>Безопасность</h2>
            <div class="hint">Активные входы в аккаунт</div></div>
            <button class="btn ghost sm" id="revoke-others">Завершить другие</button></div>
          <div id="account-sessions">${UI.empty('Загружаем сессии…','')}</div>
        </section>

        <section class="card">
          <div class="head"><h2>Личные данные</h2><a href="#" id="edit">редактировать</a></div>
          <div class="field"><div class="k">ФИО</div><div class="v">${UI.esc(me.name)}</div></div>
          <div class="field"><div class="k">Email</div><div class="v">${UI.esc(me.email)}</div></div>
          <div class="field"><div class="k">Телефон</div><div class="v">${UI.esc(me.phone)}</div></div>
          <div class="field"><div class="k">Класс и школа</div><div class="v">${prof.grade} класс · ${UI.esc(prof.school)}</div></div>
          <div class="field csp-u-045"><div class="k">Часовой пояс</div><div class="v">${UI.esc(me.tz)}</div></div>
        </section>

        <section class="card">
          <div class="head"><h2>Уведомления</h2><span class="muted small">сохраняются сразу</span></div>
          ${prefsHTML()}
        </section>

        <section class="card">
          <div class="head"><h2>Доступ родителей</h2></div>
          ${guards.length ? `<div class="row-list">${guards.map(g => {
            const u = C.user(g.parentUserId);
            return `<div class="row">
              ${UI.avatar(u.name)}
              <span class="grow"><span class="t">${UI.esc(u.name)}</span>
                <span class="s">${g.relation} · ${g.status === 'confirmed' ? 'подтверждён' : g.status}${g.isPayer ? ' · платит за занятия' : ''}</span></span>
              <span class="r">только просмотр</span></div>`;
          }).join('')}</div>` : UI.empty('Родители не подключены','')}
          <div class="note n-grey csp-u-053">
            Родитель видит прогресс, посещаемость и оценки. Не видит содержимое ваших решений
            и внутренние заметки репетитора. Вы всегда видите, кто подключён.
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="head"><div><h2>Мои предметы</h2>
            <div class="hint">Каждый предмет — своя привязка, свой репетитор и своя цель</div></div></div>
          <div class="row-list">${subjects.map(sj => {
            const t = C.tutorOf(S, sj.id);
            const g = C.goalProgress(S, sj.id);
            const gr = C.groupsOf(S, sj.id)[0];
            return `<div class="row">
              ${UI.subjectTag(sj)}
              <span class="grow"><span class="t">${UI.esc(sj.name)}</span>
                <span class="s">${t ? UI.esc(t.user.name) : 'без репетитора'} ·
                  ${gr ? 'группа «' + UI.esc(gr.title) + '»' : 'индивидуально'}${
                  g ? ' · цель ' + g.target + ' ' + C.plural(g.target,'балл','балла','баллов') : ''}</span></span>
              <span class="r">${g && g.current != null
                ? g.current + ' / ' + g.target + '<br>до экзамена ' + g.daysToExam + ' дн'
                : 'нет пробников'}</span></div>`;
          }).join('')}</div>
          <a class="btn ghost sm csp-u-054" href="invite.html">Присоединиться по коду</a>
        </section>

        ${sub ? `<section class="card csp-u-004">
          <div class="head"><h2>Абонемент</h2>
            <span class="badge ${sub.lessonsLeft <= 1 ? 'b-red' : 'b-amber'}">${sub.plan}</span></div>
          <div class="csp-u-041">Осталось занятий: ${sub.lessonsLeft}</div>
          <div class="muted small csp-u-057">
            ${sub.nextChargeAt ? 'Списание ' + C.fmtDate(sub.nextChargeAt) + ' · ' + C.fmtMoney(sub.price) : 'Списаний нет'}
            · платит ${UI.esc((C.user(sub.payerUserId)||{}).name || '—')}</div>
          <div class="csp-u-021">
            ${Array.from({length: sub.lessonsTotal}, (_, i) =>
              `<i class="subscription-segment ${i < sub.lessonsLeft ? 'subscription-segment-used' : 'subscription-segment-empty'}"></i>`).join('')}
          </div>
          <div class="note n-grey csp-u-054">Платежи в прототипе не подключены — блок только показывает состояние.</div>
        </section>` : ''}
      </div>
    </div>`;

  UI.page({
    session: ses,
    active:'account',
    head:{
      title:'Профиль',
      sub:`${prof.grade} класс · ${subjects.map(x => UI.esc(x.name)).join(', ')} · с ${new Date(prof.startedAt).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}`,
      actions:`<a class="btn ghost" href="index.html">На главную</a>`,
    },
    body,
  });

  document.querySelectorAll('[data-ch]').forEach(inp =>
    inp.addEventListener('change', () => {
      Api.setPref(inp.dataset.ch, inp.checked).catch(e => {
        inp.checked = !inp.checked;
        alert(e.message);
      });
    }));

  const ed = document.getElementById('edit');
  if (ed) ed.addEventListener('click', e => {
    e.preventDefault();
    alert('В прототипе форма редактирования не собрана: поля читаются из users / studentProfiles в assets/db.js.');
  });

  async function loadSessions() {
    const root = document.getElementById('account-sessions');
    try {
      const result = await Api.sessions();
      root.innerHTML = `<div class="row-list">${result.sessions.map(session => `<div class="row">
        <span class="grow"><span class="t">${session.current ? 'Текущая сессия' : 'Другой вход'}</span>
          <span class="s">${UI.esc(session.user_agent || 'Неизвестное устройство')} · ${UI.esc(new Date(session.created_at).toLocaleString('ru-RU'))}</span></span>
        ${session.current ? '<span class="badge b-green">сейчас</span>' : `<button class="btn ghost sm" data-session-id="${UI.esc(session.id)}">Завершить</button>`}
      </div>`).join('')}</div>`;
      root.querySelectorAll('[data-session-id]').forEach(button => button.addEventListener('click', async () => {
        await Api.revokeSession(button.dataset.sessionId);
        await loadSessions();
      }));
    } catch (error) {
      root.innerHTML = UI.empty('Не удалось загрузить сессии', UI.esc(error.message));
    }
  }
  document.getElementById('revoke-others').addEventListener('click', async () => {
    await Api.revokeOtherSessions();
    await loadSessions();
  });
  loadSessions();
})();
