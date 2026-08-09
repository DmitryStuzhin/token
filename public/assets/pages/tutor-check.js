(function () {
  const ses = Auth.require('tutor');
  if (!ses) return;
  const C = Core;
  const T = ses.tutorId;
  const queue = C.reviewQueue(T);
  const focusId = UI.qs('attempt');
  const cur = focusId ? queue.find(q => q.attempt.id === focusId) : queue[0];

  if (!queue.length) {
    UI.page({
    session: ses, active:'check', head:{ title:'Проверка работ', sub:'Очередь пуста' },
      body:`<div class="card">${UI.empty('Всё проверено',
        'Сюда попадают задания без автопроверки — например №27, где нужен сам код.')}</div>` });
    return;
  }

  function queueHTML() {
    return `<div class="card">
      <div class="head"><h2>Очередь</h2><span class="muted small">${queue.length}</span></div>
      <div class="tasklist">${queue.map(q => `
        <a href="tutor-check.html?attempt=${q.attempt.id}" class="${q.attempt.id === cur.attempt.id ? 'cur' : ''}">
          <span class="badge b-amber">№${q.task ? q.task.number : '?'}</span>
          <span class="grow">${UI.esc(q.user.name.split(' ')[0])} · ${UI.esc(q.task ? q.task.title : '')}</span>
          <span class="muted small">${C.fmtDate(q.attempt.submittedAt)}</span></a>`).join('')}</div>
    </div>`;
  }

  const a = cur.attempt, t = cur.task, u = cur.user, asg = cur.assignment;

  const body = `
    <div class="cols c2w">
      <div class="stack">
        <section class="card">
          <div class="head">
            <div class="csp-u-014">
              ${UI.avatar(u.name)}
              <div><h2>${UI.esc(u.name)}</h2>
                <div class="hint">${asg ? UI.esc(asg.title) : 'задание с занятия'} ·
                  отправлено ${C.fmtDateTime(a.submittedAt)}</div></div>
            </div>
            <span class="badge b-amber">ручная проверка</span>
          </div>
          <div class="note n-grey csp-u-047">
            <b>№${t.number} · ${UI.esc(t.title)}</b><br>${UI.esc(t.statement)}
          </div>
          <div class="editor">
            <div class="ehead"><span>код ученика</span>
              <span>${C.fmtDur(a.activeSeconds)} активной работы</span></div>
            <pre>${UI.esc(a.code || '— пусто —')}</pre>
          </div>
        </section>

        <section class="card">
          <div class="head"><h2>Оценка</h2></div>
          <div class="csp-u-019">
            <span class="muted small">Балл:</span>
            ${[0,1,2].map(n => `<button class="btn sm grey score" data-n="${n}">${n}</button>`).join('')}
            <span class="muted small">из 2 (первичный балл №${t.number})</span>
          </div>
          <textarea class="csp-u-074" id="comment" placeholder="комментарий ученику — он увидит его в карточке д/з"
           ></textarea>
          <div class="answer">
            <span class="muted small csp-u-028">Оценка запишется в Review и уйдёт в статистику ученика.</span>
            <button class="btn" id="save" disabled>Сохранить проверку</button>
          </div>
          <div id="done"></div>
        </section>
      </div>

      <div class="stack">
        ${queueHTML()}
        <div class="card">
          <div class="head"><h2>Контекст ученика</h2></div>
          <div class="field"><div class="k">Верных ответов всего</div>
            <div class="v">${C.kpi(cur.student.id).accuracy || '—'}%</div></div>
          <div class="field"><div class="k">Слабая тема</div>
            <div class="v">${(C.topicMastery(cur.student.id)[0] || {}).topic
              ? UI.esc(C.topicMastery(cur.student.id)[0].topic.name) + ' · ' + C.topicMastery(cur.student.id)[0].percent + '%'
              : '—'}</div></div>
          <div class="field csp-u-045"><div class="k">Просроченных д/з</div>
            <div class="v">${C.assignmentsOf(cur.student.id).filter(x => x.status === 'overdue').length}</div></div>
          <a class="btn ghost sm csp-u-054" href="stats.html?student=${cur.student.id}">Открыть статистику</a>
        </div>
        <div class="note n-grey">
          Сюда попадают только задания с <code>autoCheck: false</code>.
          Всё остальное проверяется автоматически и до репетитора не доходит.
        </div>
      </div>
    </div>`;

  UI.page({ session: ses, active:'check',
    head:{ title:'Проверка работ', sub:`${queue.length} ${C.plural(queue.length,'работа','работы','работ')} в очереди` },
    body });

  let score = null;
  document.querySelectorAll('.score').forEach(b =>
    b.addEventListener('click', () => {
      score = +b.dataset.n;
      document.querySelectorAll('.score').forEach(x => {
        x.classList.toggle('grey', +x.dataset.n !== score);
        if (+x.dataset.n === score) x.classList.remove('grey');
      });
      document.getElementById('save').disabled = false;
    }));

  document.getElementById('save').addEventListener('click', async () => {
    const btn = document.getElementById('save');
    btn.disabled = true;
    try {
      await Api.review(a.id, score, document.getElementById('comment').value);
    } catch (e) {
      btn.disabled = false;
      document.getElementById('done').innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
      return;
    }
    document.getElementById('done').innerHTML =
      `<div class="verdict ${score > 0 ? 'v-ok' : 'v-no'}">Проверено: ${score} из 2.
       Ученик увидит оценку и комментарий, работа ушла в статистику.
       <a href="tutor-check.html">следующая работа →</a></div>`;
  });
})();
