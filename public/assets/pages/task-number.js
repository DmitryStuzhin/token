(function () {
  const ses = Auth.require('tutor');
  if (!ses) return;
  const C = Core;
  const params = new URLSearchParams(location.search);
  const subjectId = params.get('subject') || '';
  const number = Number(params.get('number'));
  const allowed = new Set((ses.profile && ses.profile.subjects) || []);
  const subject = C.db.subjects.find(s => s.id === subjectId && allowed.has(s.id));
  const part = subject && subject.exam.parts.find(p => p.number === number);

  if (!subject || !part) {
    UI.page({ session:ses, active:'bank',
      head:{ title:'Номер не найден', sub:'Проверьте предмет и номер задания' },
      body:`<section class="card"><div class="empty">Этот номер недоступен для предметов вашего профиля.<br><br><a class="btn" href="/bank.html">Вернуться в банк задач</a></div></section>`,
    });
    return;
  }

  const tasks = C.db.tasks.filter(t => t.subjectId === subject.id && t.number === number);
  const rows = tasks.map(t => `<tr>
    <td><a href="/task-view.html?task=${encodeURIComponent(t.id)}"><b>${UI.esc(t.title)}</b></a></td>
    <td class="muted small">${UI.esc((C.topic(t.topicId) || {}).name || '')}</td>
    <td>${t.autoCheck ? '<span class="badge b-green">авто</span>' : '<span class="badge b-amber">вручную</span>'}</td>
    <td class="muted small">${UI.esc(t.answerType)} / ${UI.esc(t.compare)}</td>
    <td class="muted small">${UI.esc(t.source)}</td>
  </tr>`).join('');

  UI.page({ session:ses, active:'bank',
    head:{ title:`Задания №${number}`, sub:subject.name },
    body:`<section class="card">
      <div class="head"><div><h2>${UI.subjectTag(subject)} ${UI.esc(subject.name)} · №${number}</h2>
        <div class="hint">${tasks.length} ${C.plural(tasks.length,'задача','задачи','задач')} · максимум ${part.maxPoints} ${C.plural(part.maxPoints,'первичный балл','первичных балла','первичных баллов')}</div></div>
        <a class="btn ghost sm" href="/bank.html#bank">← К номерам</a>
      </div>
      ${tasks.length ? `<table><thead><tr><th>Задача</th><th>Тема</th><th>Проверка</th><th>Тип / сверка</th><th>Источник</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Для этого номера пока нет задач.</div>'}
    </section>`,
  });
})();
