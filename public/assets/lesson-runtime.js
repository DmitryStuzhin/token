(function () {
  'use strict';
  const session = Auth.require(['tutor', 'student']);
  if (!session) return;
  let C = Core;
  const tutor = session.role === 'tutor';
  const esc = UI.esc;

  let lesson = UI.qs('lesson') ? C.lesson(UI.qs('lesson')) : null;
  if (!lesson && tutor) {
    lesson = C.tutorToday(session.tutorId).find(item => item.status === 'planned') || C.db.lessons
      .filter(item => item.tutorId === session.tutorId && item.status === 'planned')
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
  }
  if (!lesson && !tutor) lesson = C.nextLesson(session.studentId);
  if (!lesson) {
    UI.page({ session, active:'lesson', head:{ title:'Занятие' }, body:`<div class="card">${UI.empty(
      'Занятий пока нет', tutor ? 'Назначьте занятие на странице «Сегодня».' : 'Репетитор назначит занятие — оно появится здесь.',
    )}</div>` });
    return;
  }

  let subject = C.subject(lesson.subjectId);
  let group = lesson.groupId ? C.group(lesson.groupId) : null;
  let roster = C.studentsOfLesson(lesson);
  let selectedStudent = tutor ? (UI.qs('student') || roster[0] || null) : session.studentId;
  let selectedTask = UI.qs('task') || (lesson.taskIds || [])[0] || null;
  let socket = null;
  let socketReady = false;
  let saveTimer = null;
  let activityTimer = null;
  let activeSeconds = 0;
  let idleSeconds = 0;
  let refreshTimer = null;
  let refreshPromise = null;
  let liveFrame = null;
  let liveSequence = 0;
  let socketEverOpened = false;
  let homeworkNotice = '';
  const remoteSequences = new Map();
  const remoteCodeReceivedAt = new Map();
  const remoteLaserStrokes = new Map();
  const activityEvents = ['keydown', 'mousemove', 'click', 'scroll', 'input'];
  const markActivity = () => { idleSeconds = 0; };

  const keywords = new Set('def for if elif else in return while import from not and or break continue with as lambda pass True False None class try except finally raise yield'.split(' '));
  const builtins = new Set('print range len int open max min sum sorted str list set dict input abs map enumerate zip round'.split(' '));
  const safe = value => String(value == null ? '' : value).replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[char]);
  function highlight(source) {
    return String(source || '').split('\n').map((line, index) => {
      const tokens = line.match(/\s+|#.*$|'[^']*'|"[^"]*"|\d+|[A-Za-z_]\w*|[^\sA-Za-z_0-9]+/g) || [' '];
      const body = tokens.map(token => {
        let cls = '';
        if (/^#/.test(token)) cls = 'com';
        else if (/^['"]/.test(token)) cls = 'str';
        else if (/^\d+$/.test(token)) cls = 'num';
        else if (keywords.has(token)) cls = 'kw';
        else if (builtins.has(token)) cls = 'bi';
        else if (/^[^\sA-Za-z_0-9]+$/.test(token)) cls = 'pun';
        return cls ? `<span class="${cls}">${safe(token)}</span>` : safe(token);
      }).join('');
      return `<span class="editor-line"><i>${index + 1}</i><b>${body || ' '}</b></span>`;
    }).join('');
  }

  function taskOf(id) { return id ? C.task(id) : null; }
  function attemptOf(studentId = selectedStudent, taskId = selectedTask) {
    return studentId && taskId ? C.attemptFor(studentId, taskId, { lessonId:lesson.id }) : null;
  }
  function userOf(studentId) { return studentId ? C.studentUser(studentId) : null; }
  function taskState(attempt) {
    if (!attempt || attempt.status === 'issued') return { mark:'○', text:'не открыто', cls:'' };
    if (attempt.status === 'in_progress' || attempt.status === 'returned') return { mark:'◐', text:`решает · ${C.fmtDurShort(attempt.activeSeconds)}`, cls:'live' };
    if (attempt.status === 'submitted' || attempt.status === 'resubmitted') return { mark:'◍', text:'ждёт проверки', cls:'wait' };
    if (attempt.isCorrect) return { mark:'✓', text:`верно · ${C.fmtDurShort(attempt.activeSeconds)}`, cls:'ok' };
    return { mark:'✕', text:`не зачтено · ${C.fmtDurShort(attempt.activeSeconds)}`, cls:'no' };
  }
  function taskPanel(task) {
    if (!task) return `<section class="lesson-card expanded-statement">${UI.empty('Задание не выбрано', 'Выберите задачу занятия.')}</section>`;
    const topic = C.topic(task.topicId);
    return `<section class="lesson-card expanded-statement">
      <div class="card-head"><h2 class="micro-head">№${task.number} · ${esc(topic && topic.name || subject.name)}</h2>
        <span class="kind">${task.autoCheck ? 'автопроверка' : 'ручная проверка'}</span></div>
      <h3>${esc(task.title)}</h3><p>${esc(task.statement)}</p>
      <div class="tags"><span class="tag">сложность ${task.difficulty}/3</span><span class="tag">${esc(topic && topic.name || subject.name)}</span></div>
    </section>`;
  }
  function taskList(studentId) {
    const ids = lesson.taskIds || [];
    return `<section class="lesson-card"><div class="card-head"><h2 class="micro-head">Задания занятия</h2>
      ${tutor ? '<button class="text-action" id="open-task-picker">+ из банка</button>' : ''}</div>
      <div class="task-list">${ids.length ? ids.map(id => {
        const task = taskOf(id); const state = taskState(C.attemptFor(studentId, id, { lessonId:lesson.id }));
        return `<button class="task-row ${id === selectedTask ? 'selected' : ''}" data-task="${esc(id)}">
          <span class="mark ${state.cls}">${state.mark}</span><span><strong>№${task ? task.number : '?'} · ${esc(task ? task.title : id)}</strong><small>${state.text}</small></span>
          ${tutor ? `<span class="remove-task" data-remove-task="${esc(id)}" aria-label="Убрать задачу">×</span>` : ''}</button>`;
      }).join('') : `<div class="runtime-empty">${tutor ? 'Добавьте первую задачу из банка.' : 'Репетитор пока не добавил задания.'}</div>`}</div>
      <div id="task-picker-slot"></div></section>`;
  }
  function linksCard() {
    const links = lesson.links || [];
    return `<section class="lesson-card"><div class="card-head"><h2 class="micro-head">Ссылки</h2>
      ${tutor ? '<button class="text-action" id="open-link-form">+</button>' : ''}</div>
      <div class="runtime-links">${links.length ? links.map((link, index) => `<a class="link-row" href="${esc(link.url)}" target="_blank" rel="noopener">
        <b>${link.type === 'call' ? 'СОЗВОН' : link.type === 'board' ? 'ДОСКА' : 'МАТЕРИАЛ'}</b><span>${esc(link.label)}</span><span>↗</span>
        ${tutor ? `<button data-remove-link="${index}" aria-label="Удалить ссылку">×</button>` : ''}</a>`).join('') : '<div class="runtime-empty">Ссылок пока нет.</div>'}</div>
      <div id="link-form-slot"></div></section>`;
  }
  function summaryCard(studentId) {
    const attempts = (lesson.taskIds || []).map(id => C.attemptFor(studentId, id, { lessonId:lesson.id })).filter(Boolean);
    const solved = attempts.filter(item => item.isCorrect === true).length;
    const seconds = attempts.reduce((sum, item) => sum + (item.activeSeconds || 0), 0);
    return `<section class="lesson-card"><h2 class="micro-head">Итог занятия</h2><div class="kpi-pair">
      <div class="small-kpi green"><b>${solved}</b><small>решено</small></div>
      <div class="small-kpi blue"><b>${C.fmtDurShort(seconds)}</b><small>активная работа</small></div></div>
      <p class="stat-truth">Считается по попыткам ученика; запуск кода, подсказки и правки преподавателя время не увеличивают.</p></section>`;
  }
  function homeworkCard() {
    if (!tutor) return '';
    const target = group ? `группе «${esc(group.title)}»` : esc((userOf(selectedStudent) || {}).name || 'ученику');
    return `<section class="lesson-card"><div class="card-head"><div><h2 class="micro-head">Домашнее задание</h2><p class="stat-truth">Выдать ${target} по материалам занятия.</p></div>
      <button class="text-action" id="open-homework-form" ${(lesson.taskIds || []).length ? '' : 'disabled'}>Выдать Д/З</button></div>${homeworkNotice ? `<p class="form-success" aria-live="polite">${esc(homeworkNotice)}</p>` : ''}<div id="homework-form-slot"></div></section>`;
  }
  function editor(task, attempt, options = {}) {
    if (!task || !attempt) return `<section class="lesson-card runtime-empty">Ученик ещё не открыл выбранное задание.</section>`;
    const closed = attempt.status === 'checked' || attempt.status === 'submitted';
    const canEdit = !closed && (tutor || session.studentId === attempt.studentId);
    const title = tutor ? `${esc((userOf(attempt.studentId) || {}).name || 'Ученик')} · №${task.number}` : 'Ваш черновик';
    return `<section class="interactive-editor lesson-card flush" data-attempt="${esc(attempt.id)}" data-task="${esc(task.id)}" data-student="${esc(attempt.studentId)}">
      <header class="editor-toolbar"><div><strong>${title}</strong><span>${closed ? 'работа закрыта' : tutor ? 'живой экран · изменения видит ученик' : 'сохраняется автоматически'}</span></div>
        <div class="editor-actions">${tutor ? '<button class="laser-button" type="button">Лазер</button>' : ''}<button class="run-code" type="button">▷ Запустить</button></div></header>
      <div class="editor-stage"><pre class="code-highlight" aria-hidden="true">${highlight(attempt.code || '')}</pre>
        <textarea class="code-input" spellcheck="false" aria-label="Код решения" ${canEdit ? '' : 'readonly'}>${esc(attempt.code || '')}</textarea>
        <svg class="laser-layer" aria-hidden="true" preserveAspectRatio="none"></svg></div>
      <footer class="editor-footer"><span class="editor-status idle" aria-live="polite">${closed ? 'Работа закрыта' : 'Готово к запуску · Ctrl/⌘ + Enter'}</span>
        ${!tutor ? studentActions(task, attempt, closed) : tutorActions(attempt)}</footer>
    </section>`;
  }
  function studentActions(task, attempt, closed) {
    if (task.autoCheck) return `<div class="student-answer"><input class="answer-input" value="${esc(attempt.answer || '')}" placeholder="Ответ" ${closed ? 'disabled' : ''}>
      <button class="submit-answer" ${closed ? 'disabled' : ''}>Проверить ответ</button></div>`;
    return `<div class="student-answer"><span class="answer-copy">${attempt.status === 'submitted' ? 'Отправлено на проверку' : 'Проверяет репетитор'}</span>
      <button class="submit-code" ${closed ? 'disabled' : ''}>Отправить</button></div>`;
  }
  function tutorActions(attempt) {
    return `<div class="tutor-attempt-meta"><span>попыток: ${attempt.tries || 0}</span><span>время: ${C.fmtDurShort(attempt.activeSeconds)}</span>${attempt.answer ? `<span>ответ: ${esc(attempt.answer)}</span>` : ''}</div>`;
  }

  function tutorSolo() {
    const task = taskOf(selectedTask); const attempt = attemptOf(); const student = userOf(selectedStudent);
    return `<div class="solo-layout"><div class="stack sticky">${taskList(selectedStudent)}</div>
      <div class="stack">${taskPanel(task)}${editor(task, attempt)}</div>
      <div class="stack sticky"><section class="lesson-card student-identity"><span class="mini-avatar">${initials(student && student.name)}</span><div><strong>${esc(student && student.name || 'Ученик')}</strong><small>${esc(subject.name)}</small></div></section>${linksCard()}${summaryCard(selectedStudent)}${homeworkCard()}</div></div>`;
  }
  function groupMetrics() {
    const attempts = C.attemptsOfLesson(lesson.id);
    const online = document.querySelectorAll ? null : null;
    return { solved:attempts.filter(item => item.isCorrect).length, waiting:attempts.filter(item => item.status === 'submitted').length,
      stuck:attempts.filter(item => item.status === 'in_progress' && item.activeSeconds >= 480).length, online };
  }
  function tutorGroup() {
    const metrics = groupMetrics();
    const head = (lesson.taskIds || []).map(id => `<span>№${(taskOf(id) || {}).number || '?'}</span>`).join('');
    const rows = roster.map(studentId => {
      const user = userOf(studentId); const attempts = (lesson.taskIds || []).map(id => C.attemptFor(studentId, id, { lessonId:lesson.id }));
      const cells = attempts.map((attempt, index) => { const state = taskState(attempt); return `<button class="cell ${state.cls}" data-student="${esc(studentId)}" data-task="${esc(lesson.taskIds[index])}" title="${esc(state.text)}">${state.mark}</button>`; }).join('');
      return `<div class="heat-row" data-student-row="${esc(studentId)}"><span></span><button class="student-name" data-student="${esc(studentId)}"><span class="mini-avatar">${initials(user && user.name)}</span><span>${esc(user && user.name || 'Ученик')}<small>${attempts.filter(a => a && a.isCorrect).length} из ${attempts.length}</small></span></button>${cells}<b>${attempts.filter(a => a && a.isCorrect).length} / ${attempts.length}</b></div>`;
    }).join('');
    return `<div class="group-layout"><div class="stack"><div class="group-kpis"><div class="group-kpi blue"><b>${roster.length}</b><span>участников</span></div><div class="group-kpi green"><b>${metrics.solved}</b><span>решено задач</span></div><div class="group-kpi amber"><b>${metrics.waiting}</b><span>ждут проверки</span></div><div class="group-kpi red"><b>${metrics.stuck}</b><span>дольше 8 минут</span></div></div>
      <section class="lesson-card flush"><div class="card-head group-head"><h2 class="micro-head">Прогресс группы</h2><span class="tag">Статусы каждой попытки отдельно</span></div><div class="heat-wrap"><div class="heat-table runtime-heat" style="--task-count:${Math.max(1, (lesson.taskIds || []).length)}"><div class="heat-row head"><span></span><span>Ученик</span>${head}<span>Итог</span></div>${rows}</div></div></section></div>
      <div class="stack sticky">${linksCard()}${homeworkCard()}<section class="lesson-card"><h2 class="micro-head">Как открыть работу</h2><p class="stat-truth">Нажмите имя ученика или ячейку задачи — откроется полноразмерный экран с условием и живым кодом.</p></section></div></div>`;
  }
  function studentView() {
    const task = taskOf(selectedTask); const attempt = attemptOf(session.studentId, selectedTask);
    return `<div class="student-layout"><div class="stack">${taskPanel(task)}${editor(task, attempt)}</div>
      <div class="stack sticky">${taskList(session.studentId)}${linksCard()}${summaryCard(session.studentId)}
      <section class="lesson-card"><h2 class="micro-head">Подсказки преподавателя</h2><div id="student-hints" class="student-hints"><div class="runtime-empty">Новые подсказки появятся здесь и у нужной строки.</div></div></section></div></div>`;
  }
  function initials(name) { return String(name || '?').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
  function nav() {
    const items = tutor ? [['/tutor.html','◧','Сегодня'],['/lesson.html','▶','Занятие'],['/tutor-check.html','✓','Проверка'],['/students.html','☺','Ученики'],['/groups.html','⛁','Группы'],['/invites.html','⇗','Приглашения'],['/bank.html','▤','Банк задач']]
      : [['/index.html','◧','Главная'],['/lesson.html','▶','Занятие'],['/homework.html','✎','Д/З'],['/stats.html','▤','Статистика'],['/account.html','◔','Профиль']];
    return `<aside class="lesson-rail" aria-label="Основная навигация"><a class="rail-logo" href="${session.home}" aria-label="Token">T</a><nav>${items.map(item => `<a href="${item[0]}" class="${item[1] === '▶' ? 'active' : ''}" title="${item[2]}">${item[1]}</a>`).join('')}</nav><span class="rail-avatar">${initials(session.user.name)}</span></aside>`;
  }
  function header() {
    const call = (lesson.links || []).find(link => link.type === 'call');
    const completed = lesson.status === 'done';
    const who = group ? `группа «${esc(group.title)}» · ${roster.length} участников` : tutor ? esc((userOf(selectedStudent) || {}).name || 'Ученик') : `репетитор · ${esc((((C.tutorOf(session.studentId, lesson.subjectId) || {}).user || {}).name) || '—')}`;
    const tutorAction = !tutor ? '' : completed
      ? '<span class="lesson-completed" role="status">Занятие завершено</span><a class="button primary" href="/tutor.html?new=lesson">Назначить новое</a>'
      : '<button class="button finish-button" id="finish-lesson">Завершить занятие</button>';
    return `<header class="lesson-head"><div class="lesson-identity"><i class="${completed ? 'done' : C.lessonIsLive(lesson) ? 'live' : ''}"></i><div><strong>${esc(subject.name)} · ${who}</strong><span>${C.fmtDateFull(lesson.startsAt)} · ${C.fmtTime(lesson.startsAt)} · ${lesson.durationMin} мин${completed ? ' · завершено' : ''}</span></div></div>
      <div class="lesson-actions"><span class="connection-state" id="connection-state">подключение…</span>${call && !completed ? `<a class="button primary" href="${esc(call.url)}" target="_blank" rel="noopener">Подключиться</a>` : ''}${tutorAction}</div></header>`;
  }
  function render() {
    document.body.innerHTML = `<div class="lesson-shell">${nav()}<main class="lesson-main">${header()}<div id="lesson-workspace">${tutor ? (group ? tutorGroup() : tutorSolo()) : studentView()}</div></main></div>`;
    bindCommon(); bindEditor(document.querySelector('.interactive-editor')); connectLive(); updateConnectionState();
  }

  function bindCommon() {
    document.querySelectorAll('.task-row[data-task]').forEach(button => button.addEventListener('click', event => {
      if (event.target.closest('[data-remove-task]')) return;
      selectedTask = button.dataset.task; renderWorkspace();
    }));
    document.querySelectorAll('[data-remove-task]').forEach(button => button.addEventListener('click', async event => {
      event.stopPropagation(); if (!confirm('Убрать задачу из занятия? Начатые работы сохранятся.')) return;
      await action(button, () => Api.detachTask(lesson.id, button.dataset.removeTask), 'Не удалось убрать задачу');
    }));
    document.querySelectorAll('.cell').forEach(button => button.addEventListener('click', () => openStudent(button.dataset.student, button.dataset.task)));
    document.querySelectorAll('.student-name[data-student]').forEach(button => button.addEventListener('click', () => openStudent(button.dataset.student, selectedTask || lesson.taskIds[0])));
    document.querySelectorAll('[data-remove-link]').forEach(button => button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation(); await action(button, () => Api.removeLink(lesson.id, Number(button.dataset.removeLink)), 'Не удалось удалить ссылку');
    }));
    document.getElementById('open-link-form')?.addEventListener('click', showLinkForm);
    document.getElementById('open-task-picker')?.addEventListener('click', showTaskPicker);
    document.getElementById('open-homework-form')?.addEventListener('click', showHomeworkForm);
    document.getElementById('finish-lesson')?.addEventListener('click', async event => {
      if (!confirm('Завершить занятие? Посещаемость и списание будут записаны для каждого ученика.')) return;
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Завершаю…';
      try {
        await Api.setLessonStatus(lesson.id, 'done');
        location.href = `/tutor.html?completed=${encodeURIComponent(lesson.id)}`;
      } catch (error) {
        button.disabled = false; button.textContent = 'Завершить занятие';
        alert(error.message || 'Не удалось завершить занятие');
      }
    });
  }
  function renderWorkspace() {
    const workspace = document.getElementById('lesson-workspace');
    workspace.innerHTML = tutor ? (group ? tutorGroup() : tutorSolo()) : studentView();
    bindCommon(); bindEditor(workspace.querySelector('.interactive-editor'));
  }
  async function action(button, operation, fallback) {
    button.disabled = true;
    try { await operation(); await refreshLessonState(); }
    catch (error) { button.disabled = false; alert(error.message || fallback); }
  }
  function showLinkForm() {
    const slot = document.getElementById('link-form-slot');
    slot.innerHTML = `<form class="runtime-form" id="link-form"><select name="type"><option value="call">Созвон</option><option value="board">Доска</option><option value="material">Материал</option></select><input name="url" type="url" required placeholder="https://…"><input name="label" maxlength="300" placeholder="Подпись"><button>Добавить</button><p class="form-error" aria-live="polite"></p></form>`;
    slot.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('button'); submit.disabled = true;
      try { await Api.addLink(lesson.id, Object.fromEntries(new FormData(form))); await refreshLessonState(); }
      catch (error) { submit.disabled = false; form.querySelector('.form-error').textContent = error.message; }
    });
  }
  function showTaskPicker() {
    const slot = document.getElementById('task-picker-slot');
    const pool = C.db.tasks.filter(task => task.subjectId === lesson.subjectId && !(lesson.taskIds || []).includes(task.id));
    slot.innerHTML = `<div class="runtime-picker">${pool.length ? pool.slice(0, 100).map(task => `<button data-pick-task="${esc(task.id)}"><b>№${task.number}</b><span>${esc(task.title)}</span></button>`).join('') : '<div class="runtime-empty">Все доступные задачи уже добавлены.</div>'}</div>`;
    slot.querySelectorAll('[data-pick-task]').forEach(button => button.addEventListener('click', async () => action(button, () => Api.attachTask(lesson.id, button.dataset.pickTask), 'Не удалось добавить задачу')));
  }
  function showHomeworkForm() {
    const slot = document.getElementById('homework-form-slot');
    if (slot.innerHTML) { slot.innerHTML = ''; return; }
    const due = new Date(Date.now() + 7 * 86400000); due.setHours(23, 59, 0, 0);
    const tasks = (lesson.taskIds || []).map(id => taskOf(id)).filter(Boolean);
    slot.innerHTML = `<form class="runtime-form homework-form" id="homework-form">
      <label><span>Название</span><input name="title" required maxlength="300" value="Д/З после занятия ${esc(C.fmtDate(lesson.startsAt))}"></label>
      <label><span>Срок сдачи</span><input name="dueAt" type="datetime-local" required value="${UI.dtLocal(due)}"></label>
      <fieldset><legend>Задачи</legend>${tasks.map(task => `<label class="homework-task"><input type="checkbox" name="taskId" value="${esc(task.id)}" checked><span>№${task.number} · ${esc(task.title)}</span></label>`).join('')}</fieldset>
      <button type="submit">Выдать Д/З</button><p class="form-success" aria-live="polite"></p><p class="form-error" aria-live="assertive"></p></form>`;
    slot.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]');
      const taskIds = [...form.querySelectorAll('[name="taskId"]:checked')].map(input => input.value);
      const errorNode = form.querySelector('.form-error'); const successNode = form.querySelector('.form-success');
      errorNode.textContent = ''; successNode.textContent = '';
      if (!taskIds.length) { errorNode.textContent = 'Выберите хотя бы одну задачу.'; return; }
      button.disabled = true; button.textContent = 'Выдаю…';
      const data = { title:form.elements.title.value.trim(), dueAt:new Date(form.elements.dueAt.value).toISOString(), taskIds, lessonId:lesson.id };
      if (group) data.groupId = group.id; else data.enrollmentId = lesson.enrollmentId;
      try {
        await Api.createAssignment(data);
        homeworkNotice = `Домашнее задание выдано: ${taskIds.length} ${C.plural(taskIds.length, 'задача', 'задачи', 'задач')}.`;
        successNode.textContent = homeworkNotice; button.textContent = 'Выдано';
        renderWorkspace();
      } catch (error) {
        button.disabled = false; button.textContent = 'Выдать Д/З'; errorNode.textContent = error.message;
      }
    });
  }

  function bindEditor(root) {
    if (!root) return;
    const textarea = root.querySelector('.code-input'); const highlighter = root.querySelector('.code-highlight');
    const attempt = attemptOf(root.dataset.student, root.dataset.task);
    activeSeconds = attempt ? attempt.activeSeconds || 0 : 0;
    textarea.addEventListener('scroll', () => { highlighter.scrollTop = textarea.scrollTop; highlighter.scrollLeft = textarea.scrollLeft; });
    textarea.addEventListener('keydown', event => editorKeys(textarea, event, root));
    textarea.addEventListener('input', () => {
      highlighter.innerHTML = highlight(textarea.value); idleSeconds = 0;
      queueLiveCode(root, textarea.value);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          if (tutor) await Api.coach(root.dataset.attempt, textarea.value);
          else await Api.progress(root.dataset.attempt, textarea.value, activeSeconds);
          setStatus(root, 'ok', tutor ? 'Изменение отправлено ученику' : 'Черновик сохранён');
        } catch (error) { setStatus(root, 'error', error.message); }
      }, 250);
    });
    root.querySelector('.run-code').addEventListener('click', () => runPython(root));
    if (tutor) {
      bindLaser(root);
      textarea.addEventListener('dblclick', () => showHintComposer(root, textarea));
    } else {
      root.querySelector('.submit-answer')?.addEventListener('click', () => submitAnswer(root));
      root.querySelector('.submit-code')?.addEventListener('click', () => submitCode(root));
      startActivityHeartbeat(root, textarea);
    }
  }
  function editorKeys(textarea, event, root) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runPython(root); return; }
    if (event.key === 'Tab') { event.preventDefault(); textarea.setRangeText('    ', textarea.selectionStart, textarea.selectionEnd, 'end'); textarea.dispatchEvent(new Event('input', { bubbles:true })); return; }
    if (event.key === 'Enter') {
      event.preventDefault(); const before = textarea.value.slice(0, textarea.selectionStart); const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = (line.match(/^\s*/) || [''])[0] + (line.trimEnd().endsWith(':') ? '    ' : '');
      textarea.setRangeText(`\n${indent}`, textarea.selectionStart, textarea.selectionEnd, 'end'); textarea.dispatchEvent(new Event('input', { bubbles:true }));
    }
  }
  function setStatus(root, kind, text) { const node = root.querySelector('.editor-status'); node.className = `editor-status ${kind}`; node.textContent = text; }
  async function runPython(root) {
    const button = root.querySelector('.run-code'); const code = root.querySelector('.code-input').value; let output = '';
    button.disabled = true; button.textContent = 'Запускаю…'; setStatus(root, 'running', 'Код выполняется в изолированной среде браузера…');
    try {
      if (!window.Sk) throw new Error('Среда Python не загрузилась');
      Sk.configure({ output:text => { output += text; }, read:name => { if (Sk.builtinFiles?.files[name]) return Sk.builtinFiles.files[name]; throw new Error(`Модуль ${name} не найден`); }, inputfun:() => Promise.resolve('4 9 12 15'), inputfunTakesPrompt:true, __future__:Sk.python3 });
      await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, code, true));
      setStatus(root, 'ok', `Результат: ${output.trim() || 'программа ничего не вывела'}`);
    } catch (error) { setStatus(root, 'error', `Ошибка: ${String(error).replace(/^ExternalError:\s*/, '').split('\n')[0]}`); }
    finally { button.disabled = false; button.textContent = '▷ Запустить'; }
  }
  function startActivityHeartbeat(root, textarea) {
    clearInterval(activityTimer);
    activityEvents.forEach(name => document.removeEventListener(name, markActivity));
    const attempt = attemptOf(root.dataset.student, root.dataset.task);
    if (!attempt || ['checked','submitted'].includes(attempt.status)) return;
    activityEvents.forEach(name => document.addEventListener(name, markActivity, { passive:true }));
    activityTimer = setInterval(() => {
      if (document.hidden) return; idleSeconds++;
      if (idleSeconds > 120) return; activeSeconds = Math.min(21600, activeSeconds + 1);
      if (activeSeconds % 15 === 0) Api.progress(root.dataset.attempt, textarea.value, activeSeconds).catch(error => setStatus(root, 'error', error.message));
    }, 1000);
  }
  async function submitAnswer(root) {
    const button = root.querySelector('.submit-answer'); const input = root.querySelector('.answer-input');
    if (!input.value.trim()) { setStatus(root, 'error', 'Введите ответ'); return; }
    button.disabled = true;
    try { const result = await Api.answer(root.dataset.attempt, input.value, activeSeconds); setStatus(root, result.correct ? 'ok' : 'error', result.correct ? `Верно · попыток: ${result.tries}` : `Неверно · попытка ${result.tries}`); if (result.correct) { input.disabled = true; setTimeout(() => location.reload(), 700); } else button.disabled = false; }
    catch (error) { button.disabled = false; setStatus(root, 'error', error.message); }
  }
  async function submitCode(root) {
    const button = root.querySelector('.submit-code'); button.disabled = true;
    try { await Api.submit(root.dataset.attempt, root.querySelector('.code-input').value, activeSeconds); setStatus(root, 'ok', 'Отправлено преподавателю'); setTimeout(() => location.reload(), 700); }
    catch (error) { button.disabled = false; setStatus(root, 'error', error.message); }
  }
  function bindLaser(root) {
    const button = root.querySelector('.laser-button'); const layer = root.querySelector('.laser-layer');
    let points = []; let pending = []; let path = null; let strokeId = null; let laserFrame = null;
    button.addEventListener('click', () => { button.classList.toggle('active'); root.classList.toggle('laser-active', button.classList.contains('active')); });
    const normalized = event => { const rect = layer.getBoundingClientRect(); return { x:Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y:Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
    const flush = () => {
      laserFrame = null;
      if (!strokeId || !pending.length) return;
      const batch = pending.splice(0, 48);
      send({ type:'laser_points', strokeId, points:batch });
      if (pending.length) laserFrame = requestAnimationFrame(flush);
    };
    layer.addEventListener('pointerdown', event => {
      if (!button.classList.contains('active')) return;
      const first = normalized(event);
      points = [first]; pending = []; strokeId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      path = createTrail(layer, points); layer.setPointerCapture(event.pointerId);
      send({ type:'laser_start', strokeId, studentId:root.dataset.student, taskId:root.dataset.task, points:[first] });
    });
    layer.addEventListener('pointermove', event => {
      if (!path || !layer.hasPointerCapture(event.pointerId)) return;
      const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
      const fresh = events.map(normalized);
      points.push(...fresh); pending.push(...fresh); paintTrail(path, points);
      if (!laserFrame) laserFrame = requestAnimationFrame(flush);
    });
    const finish = event => {
      if (!path || !strokeId) return;
      try { layer.releasePointerCapture(event.pointerId); } catch (_) {}
      if (laserFrame) { cancelAnimationFrame(laserFrame); laserFrame = null; }
      while (pending.length) send({ type:'laser_points', strokeId, points:pending.splice(0, 48) });
      send({ type:'laser_end', strokeId }); fadeTrail(path);
      path = null; strokeId = null; points = [];
    };
    layer.addEventListener('pointerup', finish);
    layer.addEventListener('pointercancel', finish);
  }
  function createTrail(layer, points) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); path.classList.add('laser-trail'); layer.append(path); paintTrail(path, points); return path; }
  function paintTrail(path, points) { const layer = path.ownerSVGElement; const rect = layer.getBoundingClientRect(); path.setAttribute('points', points.map(point => `${point.x * rect.width},${point.y * rect.height}`).join(' ')); }
  function fadeTrail(path) { requestAnimationFrame(() => path.classList.add('fade')); setTimeout(() => path.remove(), 1100); }
  function showHintComposer(root, textarea) {
    document.querySelector('.hint-composer')?.remove();
    const line = textarea.value.slice(0, textarea.selectionStart).split('\n').length; const box = document.createElement('form'); box.className = 'hint-composer';
    box.innerHTML = `<strong>Подсказка к строке ${line}</strong><textarea maxlength="500" required placeholder="Что подсказать ученику?"></textarea><div><button type="button">Отмена</button><button>Отправить ученику</button></div>`;
    root.append(box); box.querySelector('textarea').focus(); box.querySelector('[type="button"]').addEventListener('click', () => box.remove());
    box.addEventListener('submit', event => { event.preventDefault(); const text = box.querySelector('textarea').value.trim(); if (!text) return; send({ type:'hint', studentId:root.dataset.student, taskId:root.dataset.task, line, text }); setStatus(root, 'ok', `Подсказка к строке ${line} отправлена`); box.remove(); });
  }
  function drawRemoteLaser(message) {
    if (message.taskId !== selectedTask) return;
    const layer = document.querySelector('.interactive-editor .laser-layer'); if (!layer) return;
    if (message.type === 'laser_start') {
      const points = (message.points || []).slice();
      remoteLaserStrokes.set(message.strokeId, { points, path:createTrail(layer, points) });
      return;
    }
    const stroke = remoteLaserStrokes.get(message.strokeId);
    if (!stroke) return;
    if (message.type === 'laser_points') {
      stroke.points.push(...(message.points || []));
      paintTrail(stroke.path, stroke.points);
    } else if (message.type === 'laser_end') {
      fadeTrail(stroke.path);
      remoteLaserStrokes.delete(message.strokeId);
    }
  }
  function receiveHint(message) {
    if (message.taskId !== selectedTask) return;
    const list = document.getElementById('student-hints'); if (list) { list.querySelector('.runtime-empty')?.remove(); list.insertAdjacentHTML('afterbegin', `<div class="received-hint"><b>Строка ${message.line}</b><span>${esc(message.text)}</span></div>`); }
    const root = document.querySelector('.interactive-editor'); if (root) setStatus(root, 'ok', `Подсказка преподавателя к строке ${message.line}: ${message.text}`);
  }
  function openStudent(studentId, taskId) {
    selectedStudent = studentId; selectedTask = taskId; document.querySelector('.student-focus-overlay')?.remove();
    const task = taskOf(taskId); const attempt = attemptOf(studentId, taskId); const user = userOf(studentId); const overlay = document.createElement('div'); overlay.className = 'student-focus-overlay';
    overlay.innerHTML = `<div class="student-focus-panel"><header><div><strong>${esc(user && user.name || 'Ученик')}</strong><span>№${task ? task.number : '?'} · живой экран</span></div><button aria-label="Закрыть">×</button></header><div class="focus-content">${taskPanel(task)}${editor(task, attempt)}</div></div>`;
    document.body.append(overlay); bindEditor(overlay.querySelector('.interactive-editor')); overlay.querySelector('header button').focus();
    const close = () => overlay.remove(); overlay.querySelector('header button').addEventListener('click', close); overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  }
  function connectLive() {
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live?lesson=${encodeURIComponent(lesson.id)}`;
    try { socket = new WebSocket(url); } catch (_) { return retrySocket(); }
    socket.onopen = () => {
      socketReady = true; updateConnectionState();
      if (socketEverOpened) scheduleStateRefresh();
      socketEverOpened = true;
    };
    socket.onmessage = event => { let message; try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === 'snapshot') receiveSnapshot(message);
      if (message.type === 'code_live') receiveLiveCode(message);
      if (message.type === 'state_invalidated') scheduleStateRefresh();
      if (!tutor && ['laser_start','laser_points','laser_end'].includes(message.type)) drawRemoteLaser(message);
      if (!tutor && message.type === 'hint') receiveHint(message);
    };
    socket.onclose = () => { socketReady = false; updateConnectionState(); retrySocket(); };
    socket.onerror = () => { try { socket.close(); } catch (_) {} };
  }
  function retrySocket() { setTimeout(connectLive, 3000); }
  function send(message, notify = false) {
    if (socketReady) { socket.send(JSON.stringify(message)); return true; }
    if (notify) alert('Живой канал переподключается. Повторите через несколько секунд.');
    return false;
  }
  function updateConnectionState() {
    const state = document.getElementById('connection-state');
    if (!state) return;
    state.textContent = socketReady ? 'в сети' : 'переподключение…';
    state.classList.toggle('online', socketReady);
  }
  function queueLiveCode(root, code) {
    const sequence = ++liveSequence;
    if (liveFrame) cancelAnimationFrame(liveFrame);
    liveFrame = requestAnimationFrame(() => {
      liveFrame = null;
      send({ type:'code_live', attemptId:root.dataset.attempt, code, sequence });
    });
  }
  function receiveLiveCode(message) {
    const previous = remoteSequences.get(message.attemptId) || -1;
    if (message.sequence < previous) return;
    remoteSequences.set(message.attemptId, message.sequence);
    remoteCodeReceivedAt.set(message.attemptId, performance.now());
    const current = C.db.attempts.find(item => item.id === message.attemptId);
    if (current) current.code = message.code || '';
    const root = document.querySelector(`.interactive-editor[data-attempt="${CSS.escape(message.attemptId)}"]`);
    if (!root) return;
    const textarea = root.querySelector('.code-input');
    if (textarea.value === (message.code || '')) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    textarea.value = message.code || '';
    textarea.setSelectionRange(Math.min(start, textarea.value.length), Math.min(end, textarea.value.length));
    root.querySelector('.code-highlight').innerHTML = highlight(textarea.value);
    setStatus(root, 'ok', tutor ? 'Ученик печатает…' : 'Преподаватель редактирует код…');
  }
  function scheduleStateRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refreshLessonState(); }, 50);
  }
  async function refreshLessonState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = Store.refresh().then(() => {
      C = window.Core;
      lesson = C.lesson(lesson.id);
      if (!lesson) { location.reload(); return; }
      subject = C.subject(lesson.subjectId);
      group = lesson.groupId ? C.group(lesson.groupId) : null;
      roster = C.studentsOfLesson(lesson);
      if (tutor && !roster.includes(selectedStudent)) selectedStudent = roster[0] || null;
      if (!(lesson.taskIds || []).includes(selectedTask)) selectedTask = (lesson.taskIds || [])[0] || null;
      render();
    }).catch(error => {
      const state = document.getElementById('connection-state');
      if (state) state.textContent = error.message || 'не удалось обновить';
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  function receiveSnapshot(message) {
    (message.attempts || []).forEach(fresh => {
      const current = C.db.attempts.find(item => item.id === fresh.id);
      if (!current) return;
      const liveIsNewer = performance.now() - (remoteCodeReceivedAt.get(fresh.id) || -Infinity) < 1000;
      const liveCode = current.code;
      Object.assign(current, fresh);
      if (liveIsNewer && liveCode !== fresh.code) current.code = liveCode;
    });
    const root = document.querySelector(`.interactive-editor[data-student="${CSS.escape(message.studentId)}"]`); if (!root) return;
    const fresh = (message.attempts || []).find(item => item.taskId === root.dataset.task); const textarea = root.querySelector('.code-input');
    const liveIsNewer = fresh && performance.now() - (remoteCodeReceivedAt.get(fresh.id) || -Infinity) < 1000;
    if (fresh && !liveIsNewer && document.activeElement !== textarea && textarea.value !== (fresh.code || '')) { textarea.value = fresh.code || ''; root.querySelector('.code-highlight').innerHTML = highlight(textarea.value); setStatus(root, 'ok', tutor ? 'Получен свежий черновик ученика' : 'Преподаватель обновил код'); }
  }

  render();
})();
