(function () {
  const ses = Auth.require('tutor');
  if (!ses) return;
  const C = Core;

  /* ── предметы ───────────────────────────────────────────────── */
  function subjectsHTML() {
    const rows = C.db.subjects.map(s => {
      const ex = s.exam;
      const tasks = C.db.tasks.filter(t => t.subjectId === s.id);
      const tops = C.db.topics.filter(t => t.subjectId === s.id);
      const enr = C.db.enrollments.filter(e => e.subjectId === s.id && e.status === 'active');
      const grp = C.db.groups.filter(g => g.subjectId === s.id);
      return `<tr>
        <td>${UI.subjectTag(s)} <b>${UI.esc(s.name)}</b></td>
        <td class="muted small">${UI.esc(ex.name)} · ${ex.parts.length} заданий · макс ${C.maxPrimary(s.id)} первичных</td>
        <td class="num">${tops.length}</td>
        <td class="num">${tasks.length}</td>
        <td class="num">${enr.length}</td>
        <td class="num">${grp.length}</td>
      </tr>`;
    }).join('');
    return `<section class="card" id="subjects">
      <div class="head"><div><h2>Предметы</h2>
        <div class="hint">Номера заданий, максимумы и шкала перевода лежат в предмете — код о них не знает</div></div>
        </div>
      <table><thead><tr>
        <th>Предмет</th><th>Экзамен</th><th class="num">Тем</th><th class="num">Задач</th>
        <th class="num">Учеников</th><th class="num">Групп</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <div class="note n-blue csp-u-054">
        Добавить физику = добавить объект в <code>subjects</code> с массивом <code>exam.parts</code>
        и шкалой перевода. Ни одна страница при этом не меняется: переключатель предмета,
        статистика и сводка по номерам собираются из данных.
      </div></section>`;
  }

  /* ── привязки ───────────────────────────────────────────────── */
  /* ── группы ─────────────────────────────────────────────────── */
  /* ── приглашения ────────────────────────────────────────────── */
  /* ── абонементы ─────────────────────────────────────────────── */
  /* ── банк задач и импорт ────────────────────────────────────── */
  function bankHTML() {
    const bySubject = C.db.subjects.map(s => {
      const parts = s.exam.parts;
      const tasks = C.db.tasks.filter(t => t.subjectId === s.id);
      const byNum = {};
      tasks.forEach(t => { byNum[t.number] = (byNum[t.number] || 0) + 1; });
      const covered = Object.keys(byNum).length;
      const grid = parts.map(p => {
        const c = byNum[p.number] || 0;
        return `<div class="csp-u-067">
          <div class="bank-cell ${c ? 'bank-cell-covered' : 'bank-cell-empty'}">${c || '—'}</div>
          <div class="muted csp-u-033">№${p.number}</div></div>`;
      }).join('');
      return `<div class="csp-u-050">
        <div class="csp-u-026">
          <b>${UI.subjectTag(s)} ${UI.esc(s.name)}</b>
          <span class="muted small">${tasks.length} ${C.plural(tasks.length,'задача','задачи','задач')} ·
            покрыто ${covered} из ${parts.length} номеров ·
            ${tasks.filter(t => t.autoCheck).length} с автопроверкой</span>
        </div>
        <div class="bank-grid grid-cols-${Math.min(parts.length, 14)}">${grid}</div>
      </div>`;
    }).join('');

    const rows = C.db.tasks.map(t => `<tr>
      <td>${UI.subjectTag(C.subject(t.subjectId))}</td>
      <td><b>№${t.number}</b></td>
      <td>${UI.esc(t.title)}</td>
      <td class="muted small">${UI.esc((C.topic(t.topicId) || {}).name || '')}</td>
      <td>${t.autoCheck ? '<span class="badge b-green">авто</span>' : '<span class="badge b-amber">вручную</span>'}</td>
      <td class="muted small">${UI.esc(t.answerType)} / ${UI.esc(t.compare)}</td>
      <td class="muted small">${UI.esc(t.source)}</td>
    </tr>`).join('');

    const shape = JSON.stringify([{
      id:'q-17-100', subjectId:'inf', number:17, topicId:'t-str',
      title:'Заголовок для списка', statement:'Полный текст условия…',
      answer:'128 51872', answerType:'set', compare:'set',
      autoCheck:true, difficulty:3, source:'kompege',
    }], null, 2);

    return `<section class="card csp-u-054" id="bank">
      <div class="head"><div><h2>Банк задач</h2>
        <div class="hint">Покрытие по номерам считается из <code>subject.exam.parts</code> — у каждого предмета своя сетка</div></div></div>
      ${bySubject}
      <table><thead><tr>
        <th>Предмет</th><th>Номер</th><th>Задача</th><th>Тема</th><th>Проверка</th><th>Тип / сверка</th><th>Источник</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </section>

    <section class="card csp-u-054">
      <div class="head"><div><h2>Импорт заданий</h2>
        <div class="hint">Парсер не написан — приёмник готов и проверяет формат</div></div></div>
      <div class="note n-blue csp-u-047">
        Парсер отдаёт массив объектов такой формы. Валидируется предмет, номер задания
        в пределах сетки этого предмета и уникальность id.
      </div>
      <div class="editor csp-u-046">
        <div class="ehead"><span>ожидаемый формат</span><span>JSON</span></div>
        <pre class="csp-u-063">${UI.esc(shape)}</pre>
      </div>
      <textarea class="csp-u-073" id="imp" spellcheck="false" placeholder="вставьте сюда JSON-массив задач"
       ></textarea>
      <div class="answer">
        <button class="btn ghost sm" id="imp-demo">Подставить пример</button>
        <span class="csp-u-028"></span>
        <button class="btn" id="imp-run">Импортировать</button>
      </div>
      <div id="imp-out"></div>
      <div class="note n-grey csp-u-054">
        Обязательные: <code>id</code>, <code>subjectId</code>, <code>number</code>,
        <code>title</code>, <code>statement</code>.
        Нет <code>topicId</code> — подставится по сетке предмета.
        Нет <code>answer</code> — задача уйдёт на ручную проверку.
      </div>
    </section>`;
  }

  UI.page({
    session: ses,
    active:'bank',
    head:{ title:'Банк задач',
      sub:`${C.db.tasks.length} ${C.plural(C.db.tasks.length,'задача','задачи','задач')} ·
           ${C.db.subjects.length} ${C.plural(C.db.subjects.length,'предмет','предмета','предметов')}` },
    body: subjectsHTML() + bankHTML(),
  });


  /* ── импорт: валидацию делает сервер ────────────────────────── */
  document.getElementById('imp-demo').addEventListener('click', () => {
    document.getElementById('imp').value = JSON.stringify([{
      id:'q-18-100', subjectId:'inf', number:18, title:'Робот и таблица', topicId:'t-dp',
      statement:'Робот идёт по таблице из левого верхнего угла в правый нижний, собирая монеты. Найдите максимум и минимум.',
      answer:'143 61', answerType:'set', compare:'set', autoCheck:true, difficulty:2, source:'import-demo',
    }, {
      id:'m-13-100', subjectId:'math', number:13, title:'Сечение призмы',
      statement:'В правильной шестиугольной призме постройте сечение через три точки и найдите его площадь.',
      answer:'', autoCheck:false, difficulty:3, source:'import-demo',
    }], null, 2);
  });

  document.getElementById('imp-run').addEventListener('click', async () => {
    const out = document.getElementById('imp-out');
    const raw = document.getElementById('imp').value.trim();
    if (!raw) { out.innerHTML = `<div class="verdict v-no">Пусто — вставьте JSON.</div>`; return; }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { out.innerHTML = `<div class="verdict v-no">JSON не разобрался: ${UI.esc(e.message)}</div>`; return; }
    try {
      const res = await Api.importTasks(parsed);
      out.innerHTML = `<div class="verdict v-ok">Импортировано ${res.imported}
        ${C.plural(res.imported,'задача','задачи','задач')} — уже доступны для прикрепления.
        <a href="/bank.html">обновить</a></div>`;
    } catch (e) {
      const list = (e.details || []).slice(0, 8).map(UI.esc).join('<br>');
      out.innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}${list ? ':<br>' + list : ''}</div>`;
    }
  });

  if (location.hash) {
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ block:'start' });
  }
})();
