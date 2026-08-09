(function () {
  const ses = Auth.require('student');
  if (!ses) return;
  const C = Core;
  const S = ses.studentId;
  const taskId = UI.qs('task');
  const asgId  = UI.qs('assignment');
  const lesId  = UI.qs('lesson');
  const t = C.task(taskId);

  if (!t) {
    UI.page({ session: ses, active:'hw', head:{ title:'Задача не найдена' },
      body:`<div class="card">${UI.empty('Нет такой задачи в банке',
        'Возможно, ссылка устарела. <a href="homework.html">Вернуться к д/з</a>')}</div>` });
    return;
  }

  const scope = asgId ? { assignmentId: asgId } : lesId ? { lessonId: lesId } : {};
  const a = C.attemptFor(S, taskId, scope);
  if (!a) {
    UI.page({ session: ses, active:'hw', head:{ title:'Задача недоступна' },
      body:`<div class="card">${UI.empty('Эта задача вам не выдана',
        'Задачи появляются, когда репетитор прикрепляет их к занятию или домашнему заданию.')}</div>` });
    return;
  }
  const asg = asgId ? C.assignment(asgId) : null;
  const les = lesId ? C.lesson(lesId) : null;
  const siblings = asg ? asg.taskIds : les ? (les.taskIds || []) : [taskId];
  const backHref = asg ? 'homework.html#' + asg.id : les ? 'lesson.html' : 'homework.html';

  const locked = a.status === 'checked' || a.status === 'submitted';

  /* ── разметка ───────────────────────────────────────────────── */
  function verdictHTML() {
    if (a.status === 'submitted') return `<div class="verdict v-wait">
      Отправлено репетитору ${C.fmtDateTime(a.submittedAt)}. Проверка вручную — придёт оценка и комментарий.</div>`;
    if (a.status === 'checked') return a.isCorrect
      ? `<div class="verdict v-ok">Верно${a.tries > 1 ? ` — с ${a.tries}-й попытки` : ' с первой попытки'}. Ответ: ${UI.esc(a.answer)}</div>`
      : `<div class="verdict v-no">Проверено репетитором: не зачтено${
           a.reviewComment ? '. ' + UI.esc(a.reviewComment) : ''}</div>`;
    return '';
  }

  function navHTML() {
    if (siblings.length < 2) return '';
    const items = siblings.map((id, i) => {
      const st = C.task(id);
      const at = C.attemptFor(S, id, scope);
      const mark = !at || at.status === 'issued' ? '○'
                 : at.status === 'in_progress' ? '◐'
                 : at.isCorrect === true ? '●' : at.isCorrect === false ? '✕' : '◍';
      const q = new URLSearchParams({ task:id });
      if (asgId) q.set('assignment', asgId); if (lesId) q.set('lesson', lesId);
      return `<a href="task.html?${q}" class="${id === taskId ? 'cur' : ''}">
        <span class="csp-u-075">${mark}</span>
        <span class="grow">№${st ? st.number : '?'} · ${UI.esc(st ? st.title : id)}</span></a>`;
    }).join('');
    return `<div class="card"><div class="head"><h2>Задачи ${asg ? 'этого д/з' : 'занятия'}</h2></div>
      <div class="tasklist">${items}</div></div>`;
  }

  const body = `
    <div class="cols c2w">
      <div class="stack">
        <section class="card">
          <div class="head">
            <div>
              <h2>№${t.number} · ${UI.esc(t.title)}</h2>
              <div class="hint">${UI.esc((C.topic(t.topicId) || {}).name || '')}
                · сложность ${t.difficulty}/3
                · ${t.autoCheck ? 'автопроверка' : 'проверяет репетитор'}</div>
            </div>
            <span class="badge ${t.autoCheck ? 'b-green' : 'b-amber'}">${t.autoCheck ? 'ответ' : 'код'}</span>
          </div>
          <p class="csp-u-037">${UI.esc(t.statement)}</p>
        </section>

        <section class="card">
          <div class="head"><h2>Черновик решения</h2>
            <span class="muted small">сохраняется автоматически</span></div>
          <div class="editor">
            <div class="ehead">
              <span><span class="dot" id="live-dot"></span> редактор · виден репетитору во время занятия</span>
              <span id="timer">0 мин</span>
            </div>
            <textarea id="code" spellcheck="false" ${locked ? 'readonly' : ''}
              placeholder="# здесь пишут код решения — он не выполняется, это черновик">${UI.esc(a.code || '')}</textarea>
          </div>

          ${t.autoCheck ? `
            <div class="answer">
              <input id="answer" placeholder="ответ${t.answerType === 'set' ? ' — числа через пробел' : ''}"
                     value="${UI.esc(a.answer || '')}" ${locked ? 'disabled' : ''}>
              <button class="btn" id="check" ${locked ? 'disabled' : ''}>Проверить</button>
            </div>` : `
            <div class="answer">
              <span class="muted small csp-u-028">Задание проверяется вручную — отправьте код репетитору.</span>
              <button class="btn" id="send" ${locked ? 'disabled' : ''}>Отправить на проверку</button>
            </div>`}
          <div id="verdict">${verdictHTML()}</div>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="head"><h2>Эта попытка</h2></div>
          <div class="field"><div class="k">Откуда задача</div>
            <div class="v">${asg ? UI.esc(asg.title) : les ? 'Занятие ' + C.fmtDate(les.startsAt) : 'Свободная практика'}</div></div>
          <div class="field"><div class="k">Активное время</div><div class="v" id="time-v">${C.fmtDur(a.activeSeconds)}</div></div>
          <div class="field"><div class="k">Попыток</div><div class="v" id="tries-v">${a.tries || 0}</div></div>
          <div class="field csp-u-045"><div class="k">Статус</div>
            <div class="v" id="status-v">${(C.ASSIGNMENT_STATUS[a.status] || {}).label || a.status}</div></div>
        </section>
        ${navHTML()}
        <div class="note n-grey">
          Время считается только пока вкладка активна и есть ввод.
          Пауза через 2 минуты без действий — иначе забытая вкладка
          испортила бы сводку по номерам заданий.
        </div>
        <a class="btn ghost" href="${backHref}">← ${asg ? 'к домашнему заданию' : les ? 'к занятию' : 'к списку'}</a>
      </div>
    </div>`;

  UI.page({ session: ses, active: lesId ? 'lesson' : 'hw',
    head: { title:'Решение задачи', sub:`${asg ? UI.esc(asg.title) : les ? 'Задание с занятия' : 'Практика'}` },
    body });

  /* ── таймер активного времени ───────────────────────────────── */
  let idle = 0;
  let accrued = a.activeSeconds || 0;
  let sincePersist = 0;
  const timerEl = document.getElementById('timer');
  const timeV = document.getElementById('time-v');
  const dot = document.getElementById('live-dot');

  function poke() { idle = 0; }
  ['keydown','mousemove','click','scroll','input'].forEach(ev =>
    document.addEventListener(ev, poke, { passive:true }));

  if (!locked) {
    setInterval(() => {
      if (document.hidden) { dot.classList.add('off'); return; }
      idle++;
      const active = idle <= 120;
      dot.classList.toggle('off', !active);
      if (!active) return;
      accrued++; sincePersist++;
      timerEl.textContent = C.fmtDurShort(accrued);
      timeV.textContent = C.fmtDur(accrued);
      if (sincePersist >= 15) {                       /* heartbeat на сервер */
        sincePersist = 0;
        Api.progress(a.id, code ? code.value : '', accrued).catch(() => {});
      }
    }, 1000);
  } else {
    dot.classList.add('off');
  }
  timerEl.textContent = C.fmtDurShort(accrued);

  /* ── черновик кода ──────────────────────────────────────────── */
  const code = document.getElementById('code');
  let codeTimer = null;
  if (code && !locked) {
    code.addEventListener('input', () => {
      clearTimeout(codeTimer);
      /* черновик уходит на сервер — оттуда его видит репетитор */
      codeTimer = setTimeout(() => Api.progress(a.id, code.value, accrued).catch(() => {}), 600);
    });
  }

  /* ── проверка ───────────────────────────────────────────────── */
  const btn = document.getElementById('check');
  if (btn) btn.addEventListener('click', async () => {
    const input = document.getElementById('answer');
    const val = input.value;
    if (!val.trim()) return;
    btn.disabled = true;
    const verdict = document.getElementById('verdict');
    try {
      /* сверка — на сервере: эталонного ответа в браузере нет */
      const res = await Api.answer(a.id, val, accrued);
      document.getElementById('tries-v').textContent = res.tries;
      verdict.innerHTML = res.correct
        ? `<div class="verdict v-ok">Верно${res.tries > 1 ? ` — с ${res.tries}-й попытки` : ' с первой попытки'}.
           Задача ушла в статистику.</div>`
        : `<div class="verdict v-no">Неверно. Попробуйте ещё раз — попытка ${res.tries}.</div>`;
      if (res.correct) {
        input.disabled = true;
        document.getElementById('status-v').textContent = 'проверено';
        if (code) code.readOnly = true;
      } else {
        btn.disabled = false;
        input.select();
      }
    } catch (e) {
      btn.disabled = false;
      verdict.innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  });

  const send = document.getElementById('send');
  if (send) send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await Api.submit(a.id, code ? code.value : '', accrued);
      if (code) code.readOnly = true;
      document.getElementById('status-v').textContent = 'на проверке';
      document.getElementById('verdict').innerHTML =
        `<div class="verdict v-wait">Отправлено репетитору. Ждём оценку и комментарий.</div>`;
    } catch (e) {
      send.disabled = false;
      document.getElementById('verdict').innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  });
})();
