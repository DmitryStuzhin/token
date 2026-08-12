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
  const nextLesson = today[0] || upcoming[0] || null;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const tutorEnrollmentIds = C.db.enrollments.filter(e => e.tutorId === T).map(e => e.id);
  const tutorGroupIds = groups.map(g => g.id);
  const tutorLessons = C.db.lessons.filter(l =>
    (l.enrollmentId && tutorEnrollmentIds.includes(l.enrollmentId)) ||
    (l.groupId && tutorGroupIds.includes(l.groupId)));
  function rateFor(studentId, subjectId, at) {
    const day = new Date(at || Date.now()).toISOString().slice(0, 10);
    const custom = (C.db.studentRates || []).filter(rate =>
      rate.tutorId === T && rate.studentId === studentId && rate.subjectId === subjectId &&
      String(rate.effectiveAt) <= day)
      .sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)))[0];
    return custom ? Number(custom.rate) : Number(tp.rate || 0);
  }
  function lessonIncome(lesson) {
    return [...new Set(C.studentsOfLesson(lesson))]
      .reduce((sum, studentId) => sum + rateFor(studentId, lesson.subjectId, lesson.startsAt), 0);
  }
  const lessonsThisWeek = tutorLessons.filter(l => {
    const at = new Date(l.startsAt);
    return at >= weekStart && at < weekEnd && l.status !== 'cancelled';
  });

  /* ── показатели ─────────────────────────────────────────────── */
  function kpiHTML() {
    const cells = [
      { v: sids.length, s:'учеников', c:'k-green' },
      { v: lessonsThisWeek.length, s:'занятий на неделе', c:'k-blue' },
      { v: `${lessonsThisWeek.reduce((sum, l) => sum + (l.durationMin || 0), 0) / 60}`.replace('.5', ',5') + ' ч', s:'нагрузка', c:'k-amber' },
      { v: queue.length, s:'работ на проверке', c:'k-violet' },
    ];
    return `<section class="kpis tutor-kpis">${cells.map(x =>
      `<div class="kpi ${x.c}"><b>${x.v}</b><span>${x.s}</span></div>`).join('')}</section>`;
  }

  function nextLessonHTML() {
    if (!nextLesson) return `<section class="tutor-next tutor-next-empty">
      <div><span class="tutor-eyebrow">Ближайшее занятие</span>
        <h2>Занятий пока не запланировано</h2>
        <p>Создайте занятие для ученика или группы.</p></div>
      ${sids.length ? '<a class="btn white" href="/tutor.html?new=lesson">Назначить занятие</a>' : '<a class="btn white" href="/students.html#invitations">Пригласить ученика</a>'}</section>`;
    const subj = C.subject(nextLesson.subjectId);
    const group = nextLesson.groupId ? C.group(nextLesson.groupId) : null;
    const student = C.studentUser(C.studentsOfLesson(nextLesson)[0]);
    const who = group ? group.title : (student || {}).name || 'Ученик';
    const day = C.relDay(nextLesson.startsAt) || C.fmtDate(nextLesson.startsAt);
    return `<section class="tutor-next">
      <div><span class="tutor-eyebrow">Ближайшее занятие</span>
        <h2>${UI.esc((subj || {}).name || 'Занятие')} · ${day} в ${C.fmtTime(nextLesson.startsAt)}</h2>
        <p>${UI.esc(who)} · ${nextLesson.durationMin} минут</p></div>
      <a class="btn white" href="/lesson.html?lesson=${nextLesson.id}">Открыть занятие</a>
    </section>`;
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
    return `<section class="card tutor-schedule">
      <div class="head"><div><h2>Расписание на сегодня</h2>
        <div class="hint">${C.fmtDateFull(Date.now())}</div></div>
        ${sids.length ? '<button class="btn sm" id="newlesson">Назначить занятие</button>' : ''}</div>
      ${completedNotice}${body}
      <div id="lessonform"></div></section>`;
  }

  function activityHTML() {
    const rows = sids.map(sid => {
      const user = C.studentUser(sid);
      const kpi = C.kpi(sid);
      const progress = kpi.accuracy == null ? 0 : kpi.accuracy;
      return { sid, user, kpi, progress };
    }).sort((a, b) => b.kpi.solvedWeek - a.kpi.solvedWeek).slice(0, 5);
    const body = rows.length ? rows.map(x => `<a class="tutor-student" href="/stats.html?student=${x.sid}">
      ${UI.avatar(x.user.name)}
      <span class="grow"><b>${UI.esc(x.user.name)}</b><small>${x.kpi.solvedWeek} ${C.plural(x.kpi.solvedWeek,'задача','задачи','задач')} за неделю</small></span>
      <span class="tutor-progress"><i class="width-${Math.round(x.progress / 5) * 5}"></i></span>
      <strong>${x.kpi.accuracy == null ? '—' : x.kpi.accuracy + '%'}</strong>
    </a>`).join('') : UI.empty('Активности пока нет', 'Здесь появится прогресс ваших учеников.');
    return `<section class="card tutor-activity"><div class="head"><div><h2>Активность учеников</h2>
      <div class="hint">Решённые задачи и точность за неделю</div></div><a href="/students.html">Все ученики</a></div>${body}</section>`;
  }

  function incomeHTML() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const completed = tutorLessons.filter(l => {
      const at = new Date(l.startsAt);
      return l.status === 'done' && at >= monthStart && at < monthEnd;
    });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const marks = [1, 8, 15, 22, daysInMonth];
    const totals = marks.map(day => completed
      .filter(l => new Date(l.startsAt).getDate() <= day)
      .reduce((sum, lesson) => sum + lessonIncome(lesson), 0));
    const maximum = Math.max(...totals, Number(tp.rate || 0) || 1);
    const points = totals.map((value, index) => {
      const x = 12 + index * 44;
      const y = 86 - Math.round(value / maximum * 66);
      return `${x},${y}`;
    }).join(' ');
    const amount = completed.reduce((sum, lesson) => sum + lessonIncome(lesson), 0);
    return `<section class="card tutor-income">
      <div class="head"><div><h2>Доход</h2><div class="hint">За ${now.toLocaleDateString('ru-RU',{month:'long'})}</div></div>
        <span class="badge b-green">${completed.length} ${C.plural(completed.length,'занятие','занятия','занятий')}</span></div>
      <strong>${C.fmtMoney(amount)}</strong>
      <div class="tutor-income-note">По индивидуальным ставкам учеников · базовая ${C.fmtMoney(tp.rate || 0)}</div>
      <svg class="tutor-income-chart" viewBox="0 0 200 100" role="img" aria-label="Накопительный доход за месяц">
        <line x1="12" y1="86" x2="188" y2="86"></line>
        <polyline points="${points}"></polyline>
        ${points.split(' ').map(point => { const [x,y] = point.split(','); return `<circle cx="${x}" cy="${y}" r="3"></circle>`; }).join('')}
      </svg>
      <div class="tutor-income-axis"><span>1 ${now.toLocaleDateString('ru-RU',{month:'short'})}</span><span>15 ${now.toLocaleDateString('ru-RU',{month:'short'})}</span><span>${daysInMonth} ${now.toLocaleDateString('ru-RU',{month:'short'})}</span></div>
    </section>`;
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
      <a href="/students.html#invitations">«Ученики»</a> и создайте приглашение внизу страницы.
    </div>`;
  }

  UI.page({
    session: ses,
    active: 'today',
    head: { title:`Добро пожаловать, ${UI.esc(me.name.split(' ')[0])}!`,
      sub:C.fmtDateFull(Date.now()),
      actions: queue.length ? `<a class="btn ghost" href="/tutor-check.html">На проверке · ${queue.length}</a>` : '' },
    body: `<div class="tutor-dashboard">${hintHTML()}${nextLessonHTML()}${kpiHTML()}
      ${todayHTML()}<div class="cols c2 tutor-lower">${activityHTML()}${incomeHTML()}</div>
      ${queueHTML()}${upcomingHTML()}</div>`,
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
