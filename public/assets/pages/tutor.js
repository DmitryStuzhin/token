(function () {
  const ses = Auth.require('tutor');
  if (!ses) return;
  const C = Core;
  const T = ses.tutorId;
  const tp = C.tutorProfile(T);
  const me = C.user(tp.userId);
  const todayAll = C.tutorToday(T);
  const today = todayAll.filter(l => l.status === 'planned');
  const completedToday = todayAll.filter(l => l.status === 'done');
  const queue = C.reviewQueue(T);
  const sids = C.studentsOfTutor(T);
  const groups = C.groupsOfTutor(T);
  const upcoming = C.db.lessons
    .filter(l => l.tutorId === T && l.status === 'planned' && new Date(l.startsAt) > Date.now())
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .filter(l => !today.some(t => t.id === l.id))
    .slice(0, 5);

  /* ── показатели ─────────────────────────────────────────────── */
  function kpiHTML() {
    const overdue = sids.reduce((s, sid) =>
      s + C.assignmentsOf(sid).filter(a => a.status === 'overdue').length, 0);
    const cells = [
      { v: todayAll.length,  s:'занятий сегодня', c:'k-blue' },
      { v: queue.length,  s:'работ на проверке', c: queue.length ? 'k-amber' : 'k-green' },
      { v: sids.length,   s:'учеников', c:'k-violet' },
      { v: groups.length, s:'групп', c:'k-green' },
      { v: overdue,       s:'просроченных д/з', c: overdue ? 'k-red' : 'k-green' },
    ];
    return `<section class="kpis kpis-5">${cells.map(x =>
      `<div class="kpi ${x.c}"><b>${x.v}</b><span>${x.s}</span></div>`).join('')}</section>`;
  }

  /* ── строка занятия ─────────────────────────────────────────── */
  function lessonRow(l, withDate) {
    const live = C.lessonIsLive(l);
    const call = (l.links || []).find(x => x.type === 'call');
    const subj = C.subject(l.subjectId);
    const when = (withDate ? (C.relDay(l.startsAt) || C.fmtDate(l.startsAt)) + ', ' : '') + C.fmtTime(l.startsAt);
    const grp = l.groupId ? C.group(l.groupId) : null;
    const who = grp ? UI.esc(grp.title) : UI.esc((C.studentUser(C.studentsOfLesson(l)[0]) || {}).name || '—');
    const face = grp
      ? `<div class="avatar csp-u-003">${C.membersOf(grp.id).length}</div>`
      : UI.avatar(who);
    return `<div class="row">
      ${face}
      <span class="grow"><span class="t">${who}${live ? ' <span class="badge b-green">идёт</span>' : ''}</span>
        <span class="s">${when} · ${l.durationMin} мин ·
          ${grp ? 'группа' : 'индивидуально'} ·
          ${(l.taskIds || []).length} ${C.plural((l.taskIds||[]).length,'задание','задания','заданий')}</span></span>
      <span class="r acts-inline">
        ${UI.subjectTag(subj)}
        ${call ? `<a class="btn sm ghost" href="${UI.esc(call.url)}" target="_blank" rel="noopener">Созвон</a>` : ''}
        <a class="btn sm" href="/lesson.html?lesson=${l.id}">Вести</a>
      </span></div>`;
  }

  function todayHTML() {
    const body = today.length
      ? `<div class="row-list">${today.map(l => lessonRow(l, false)).join('')}</div>`
      : UI.empty('Занятий сегодня нет', sids.length
          ? 'Назначьте занятие ученику или группе.'
          : 'Сначала пригласите ученика — вкладка «Приглашения».');
    const completedNotice = UI.qs('completed')
      ? `<div class="note n-green" id="completed-notice" role="status">Занятие завершено и сохранено. Сегодня проведено: ${completedToday.length}.</div>`
      : '';
    return `<section class="card">
      <div class="head"><div><h2>Сегодня</h2>
        <div class="hint">${C.fmtDateFull(Date.now())}</div></div>
        ${sids.length ? '<button class="btn sm" id="newlesson">Назначить занятие</button>' : ''}</div>
      ${completedNotice}${body}
      <div id="lessonform"></div></section>`;
  }

  function upcomingHTML() {
    if (!upcoming.length) return '';
    return `<section class="card">
      <div class="head"><h2>Дальше</h2>
        <span class="muted small">${upcoming.length} ${C.plural(upcoming.length,'занятие','занятия','занятий')}</span></div>
      <div class="row-list">${upcoming.map(l => lessonRow(l, true)).join('')}</div></section>`;
  }

  function queueHTML() {
    if (!queue.length) return `<section class="card">
      <div class="head"><h2>На проверке</h2></div>
      ${UI.empty('Очередь пуста','Сюда попадают задания без автопроверки.')}</section>`;
    const rows = queue.slice(0, 6).map(q => `
      <a class="row" href="/tutor-check.html?attempt=${q.attempt.id}">
        <span class="badge b-amber">№${q.task ? q.task.number : '?'}</span>
        <span class="grow"><span class="t">${UI.esc(q.user.name)} · ${UI.esc(q.task ? q.task.title : '')}</span>
          <span class="s">${q.assignment ? UI.esc(q.assignment.title) : 'с занятия'} ·
            ${C.fmtDur(q.attempt.activeSeconds)} в работе</span></span>
        <span class="r">${C.fmtDate(q.attempt.submittedAt)}</span></a>`).join('');
    return `<section class="card">
      <div class="head"><h2>На проверке</h2><a href="/tutor-check.html">вся очередь</a></div>
      <div class="row-list">${rows}</div></section>`;
  }

  /* нет учеников — короткая подсказка, а не баннер во весь экран */
  function hintHTML() {
    if (sids.length) return '';
    return `<div class="note n-blue csp-u-047">
      Учеников пока нет. Они появляются сами: выпустите ссылку во вкладке
      <a href="/invites.html">«Приглашения»</a> и отправьте её.
    </div>`;
  }

  UI.page({
    session: ses,
    active: 'today',
    head: { title:`Здравствуйте, ${me.name.split(' ')[0]}!`,
      sub:`${sids.length} ${C.plural(sids.length,'ученик','ученика','учеников')} · ${groups.length}
           ${C.plural(groups.length,'группа','группы','групп')} · ${(tp.subjects || [])
             .map(id => UI.esc((C.subject(id) || {}).name || id)).join(', ')}`,
      actions:`<a class="btn ghost" href="/tutor-check.html">Очередь проверки</a>` },
    body: `${hintHTML()}${kpiHTML()}
      <div class="cols c2">${todayHTML()}${queueHTML()}</div>
      ${upcomingHTML()}`,
  });

  /* ── назначение занятия ─────────────────────────────────────── */
  const nl = document.getElementById('newlesson');
  if (nl) nl.addEventListener('click', () => {
    const slot = document.getElementById('lessonform');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const targets = [];
    C.db.enrollments.filter(e => e.tutorId === T && e.status === 'active').forEach(e =>
      targets.push({ v:'e:' + e.id,
        t: (C.studentUser(e.studentId) || {}).name + ' · ' + (C.subject(e.subjectId) || {}).name }));
    groups.forEach(g => targets.push({ v:'g:' + g.id,
      t: 'Группа «' + g.title + '» · ' + (C.subject(g.subjectId) || {}).name }));
    if (!targets.length) { alert('Сначала пригласите ученика или создайте группу.'); return; }

    const start = new Date(Date.now() + 3600000); start.setMinutes(0, 0, 0);
    slot.innerHTML = `<div class="subform">
      <div class="head"><h2>Новое занятие</h2><a href="#" id="closeles">закрыть</a></div>
      <div class="form-row">
        <label class="fld csp-u-031"><span>Кому</span>
          <select id="n-target">${targets.map(x =>
            `<option value="${x.v}">${UI.esc(x.t)}</option>`).join('')}</select></label>
        <label class="fld csp-u-065"><span>Начало</span>
          <input id="n-start" type="datetime-local" value="${UI.dtLocal(start)}"></label>
        <label class="fld csp-u-060"><span>Минут</span>
          <input id="n-dur" type="number" min="15" step="15" value="90"></label>
        <button class="btn" id="n-make">Назначить</button>
      </div></div>`;
    document.getElementById('closeles').addEventListener('click', e => { e.preventDefault(); slot.innerHTML = ''; });
    document.getElementById('n-make').addEventListener('click', async () => {
      const [kind, id] = document.getElementById('n-target').value.split(':');
      const when = document.getElementById('n-start').value;
      if (!when) { alert('Укажите дату и время'); return; }
      try {
        const data = {
          startsAt: new Date(when).toISOString(),
          durationMin: +document.getElementById('n-dur').value || 60,
        };
        if (kind === 'e') data.enrollmentId = id;
        else data.groupId = id;
        const res = await Api.createLesson(data);
        location.href = '/lesson.html?lesson=' + res.id;
      } catch (e) { alert(e.message); }
    });
  });
  if (nl && UI.qs('new') === 'lesson') nl.click();
})();
