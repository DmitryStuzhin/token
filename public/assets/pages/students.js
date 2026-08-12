(function () {
  const ses = Auth.require('tutor');
  if (!ses) return;
  const C = Core;
  const T = ses.tutorId;
  const tutor = C.tutorProfile(T);
  const sids = C.studentsOfTutor(T);
  const invitations = InvitationPanel.create(ses);

  function priceEditor(sid, subject) {
    const custom = (C.db.studentRates || []).filter(rate =>
      rate.tutorId === T && rate.studentId === sid && rate.subjectId === subject.id)
      .sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)))[0];
    const value = custom ? custom.rate : Number(tutor.rate || 0);
    return `<div class="student-rate-row">
      ${UI.subjectTag(subject)}
      <label><input class="student-rate-input" type="number" min="0" max="1000000" step="100"
        value="${value}" aria-label="Стоимость занятия по предмету ${UI.attr(subject.name)}"></label>
      <span>₽</span><button class="btn sm ghost student-rate-save" data-student="${UI.attr(sid)}"
        data-subject="${UI.attr(subject.id)}">Сохранить</button>
    </div>`;
  }

  function tableHTML() {
    if (!sids.length) return `<section class="card">
      <div class="head"><h2>Ученики</h2></div>
      ${UI.empty('Учеников пока нет',
        'Они появляются сами: выпустите ссылку-приглашение и отправьте её.')}
      <a class="btn csp-u-054" href="#invitations">Выпустить приглашение</a>
    </section>`;

    const rows = sids.map(sid => {
      const u = C.studentUser(sid);
      const prof = C.student(sid);
      const subs = C.subjectsOf(sid);
      const k = C.kpi(sid);
      const grs = C.groupsOf(sid);
      const overdue = C.assignmentsOf(sid).filter(a => a.status === 'overdue').length;
      const weak = C.topicMastery(sid)[0];
      const next = C.nextLesson(sid);
      return `<tr>
        <td><div class="who">${UI.avatar(u.name)}
          <div><b>${UI.esc(u.name)}</b>
            <div class="muted small">${prof ? prof.grade + ' класс' : ''}${
              grs.length ? ' · ' + UI.esc(grs[0].title) : ' · индивидуально'}</div></div></div></td>
        <td>${subs.map(UI.subjectTag).join(' ') || '<span class="muted small">—</span>'}</td>
        <td><div class="student-rates">${subs.map(subject => priceEditor(sid, subject)).join('')}</div></td>
        <td class="num ${UI.pctClass(k.accuracy)}">${k.accuracy == null ? '—' : k.accuracy + '%'}</td>
        <td class="num">${k.solvedWeek}</td>
        <td class="num">${overdue ? `<span class="badge b-red">${overdue}</span>` : '<span class="muted">0</span>'}</td>
        <td class="muted small">${weak ? UI.esc(weak.topic.name) + ' · ' + weak.percent + '%' : '—'}</td>
        <td class="muted small">${next ? (C.relDay(next.startsAt) || C.fmtDate(next.startsAt)) + ', ' + C.fmtTime(next.startsAt) : '—'}</td>
        <td class="num csp-u-070">
          <a class="btn sm ghost" href="/stats.html?student=${sid}">Статистика</a>
          ${next ? `<a class="btn sm" href="/lesson.html?lesson=${next.id}">Занятие</a>` : ''}
        </td>
      </tr>`;
    }).join('');

    return `<section class="card">
      <div class="head"><div><h2>Ученики</h2>
        <div class="hint">Индивидуальные привязки и участники групп — один список</div></div>
        <a class="btn sm" href="#invitations">Пригласить ещё</a></div>
      <table><thead><tr>
        <th>Ученик</th><th>Предметы</th><th>Стоимость занятия</th><th class="num">Верных</th><th class="num">За неделю</th>
        <th class="num">Просрочки</th><th>Слабая тема</th><th>Ближайшее занятие</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }

  UI.page({
    session: ses,
    active: 'students',
    head: { title:'Ученики',
      sub:`${sids.length} ${C.plural(sids.length,'ученик','ученика','учеников')}` },
    body: `<div class="stack">${tableHTML()}${invitations.html()}</div>`,
  });

  invitations.bind();

  document.querySelectorAll('.student-rate-save').forEach(button => {
    button.addEventListener('click', async () => {
      const row = button.closest('.student-rate-row');
      const input = row.querySelector('.student-rate-input');
      const rate = Number(input.value);
      if (!Number.isFinite(rate) || rate < 0) {
        input.focus();
        return;
      }
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Сохраняю…';
      try {
        await Api.setStudentRate(button.dataset.student, button.dataset.subject, rate);
        button.textContent = 'Сохранено';
        setTimeout(() => { button.textContent = oldText; button.disabled = false; }, 1200);
      } catch (error) {
        button.textContent = 'Ошибка';
        button.disabled = false;
        alert(error.message);
      }
    });
  });
})();
