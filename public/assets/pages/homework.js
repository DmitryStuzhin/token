(function () {
  const ses = Auth.require('student');
  if (!ses) return;
  const C = Core;
  const S = ses.studentId;
  let subj = UI.subjectId(S);
  let all = C.assignmentsOf(S, subj);

  const GROUPS = [
    { key:'all',      label:'Все',         test:() => true },
    { key:'active',   label:'Активные',    test:a => ['issued','in_progress','overdue'].includes(a.status) },
    { key:'submitted',label:'На проверке', test:a => a.status === 'submitted' },
    { key:'checked',  label:'Проверено',   test:a => a.status === 'checked' },
  ];

  function summary() {
    const c = k => all.filter(a => a.status === k).length;
    const cells = [
      { v:c('overdue'),  s:'просрочено',  cls:c('overdue') ? 'k-red' : 'k-green' },
      { v:all.filter(a => a.status !== 'checked' && a.daysLeft >= 0 && a.daysLeft <= 2).length, s:'горит срок', cls:'k-amber' },
      { v:c('in_progress') + c('issued'), s:'в работе', cls:'k-blue' },
      { v:c('checked'),  s:'проверено',   cls:'k-green' },
    ];
    return `<section class="kpis">${cells.map(x =>
      `<div class="kpi ${x.cls}"><b>${x.v}</b><span>${x.s}</span></div>`).join('')}</section>`;
  }

  function card(a) {
    const st = C.ASSIGNMENT_STATUS[a.status];
    const left = a.daysLeft;
    const due = left < 0 ? `просрочено на ${Math.abs(left)} ${C.plural(Math.abs(left),'день','дня','дней')}`
              : left === 0 ? 'сдать сегодня'
              : `осталось ${left} ${C.plural(left,'день','дня','дней')}`;
    const pct = a.total ? Math.round((a.done / a.total) * 100) : 0;

    const tasks = a.taskIds.map(id => {
      const t = C.task(id);
      const at = C.attemptFor(S, id, { assignmentId: a.id });
      const state = !at || at.status === 'issued' ? { m:'○', c:'task-mark-muted', s:'не начато' }
        : at.status === 'in_progress' ? { m:'◐', c:'task-mark-brand', s:C.fmtDurShort(at.activeSeconds) }
        : at.status === 'submitted' ? { m:'◍', c:'task-mark-amber', s:'на проверке' }
        : at.isCorrect ? { m:'●', c:'task-mark-green', s:'верно' + (at.tries > 1 ? ` (${at.tries} поп.)` : '') }
        : { m:'✕', c:'task-mark-red', s:'неверно' };
      return `<a class="row" href="task.html?task=${id}&assignment=${a.id}">
        <span class="task-mark ${state.c}">${state.m}</span>
        <span class="grow"><span class="t">№${t ? t.number : '?'} · ${UI.esc(t ? t.title : id)}</span>
          <span class="s">${t ? UI.esc((C.topic(t.topicId)||{}).name || '') : ''}${t && !t.autoCheck ? ' · проверяет репетитор' : ''}</span></span>
        <span class="r">${state.s}</span></a>`;
    }).join('');

    const assignmentClass = a.status === 'overdue' ? 'assignment-overdue'
      : a.status === 'checked' ? 'assignment-checked'
      : a.status === 'submitted' ? 'assignment-submitted' : 'assignment-active';
    return `<section class="card ${assignmentClass}" id="${a.id}">
      <div class="head">
        <div>
          <div class="csp-u-018">
            <span class="badge ${st.cls}">${st.label}</span>
            ${UI.subjectTag(C.subject(a.subjectId))}
            ${a.isGroup ? `<span class="badge b-violet">группа · ${UI.esc(a.groupTitle)}</span>` : ''}
            <span class="muted small">выдано на занятии ${a.lessonId && C.lesson(a.lessonId)
              ? C.fmtDate(C.lesson(a.lessonId).startsAt) : '—'}</span>
          </div>
          <h2 class="csp-u-039">${UI.esc(a.title)}</h2>
          <div class="hint">${a.total} ${C.plural(a.total,'задача','задачи','задач')}
            · потрачено ${C.fmtDurShort(a.seconds)}
            ${a.done ? ' · верных ' + a.correct + ' из ' + a.done : ''}</div>
        </div>
        <div class="csp-u-068">
          <div class="csp-u-036">${due}</div>
          <div class="muted small">до ${C.fmtDateTime(a.dueAt)}</div>
        </div>
      </div>
      <div class="csp-u-013">
        ${UI.bar(pct, a.status === 'overdue' ? 'var(--red)' : null)}
        <span class="muted small csp-u-070">${a.done} из ${a.total}</span>
      </div>
      <div class="row-list">${tasks}</div>
    </section>`;
  }

  function render(groupKey) {
    const g = GROUPS.find(x => x.key === groupKey) || GROUPS[0];
    const list = all.filter(g.test);
    const filters = `<div class="filters">${GROUPS.map(x =>
      `<button data-k="${x.key}" class="${x.key === groupKey ? 'on' : ''}">${x.label}
        <span class="count">${all.filter(x.test).length}</span></button>`).join('')}</div>`;
    const body = list.length
      ? list.map(card).join('')
      : UI.empty('Здесь пусто', 'В этой группе сейчас нет заданий.');
    document.getElementById('content').innerHTML =
      summary() + filters + `<div class="stack">${body}</div>`;
    document.querySelectorAll('.filters button').forEach(b =>
      b.addEventListener('click', () => render(b.dataset.k)));
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView({ block:'center' });
    }
  }

  UI.page({
    session: ses,
    active:'hw',
    head:{ title:'Домашние задания',
      sub: C.subjectsOf(S).map(x => x.name).join(', '),
      actions: UI.subjectSwitcher(S, subj) },
    body:'',
  });
  UI.bindSubjectSwitcher(id => { subj = id; all = C.assignmentsOf(S, subj); render('all'); });
  render('all');
})();
