(function () {
  const ses = Auth.require();
  if (!ses) return;
  const C = Core;
  const asParent = ses.role === 'parent';
  const S = UI.qs('student') || ses.studentId;
  const stUser = C.studentUser(S);
  const statSubjectIds = new Set(C.subjectsOf(S).map(s => s.id));
  C.attemptsOf(S).forEach(a => { if (a.subjectId) statSubjectIds.add(a.subjectId); });
  const statSubjects = [...statSubjectIds].map(id => C.subject(id)).filter(Boolean);
  if (!statSubjects.length && ses.role === 'student') statSubjects.push(...C.db.subjects);
  const requestedSubject = UI.qs('subject');
  let subj = statSubjects.some(s => s.id === requestedSubject) ? requestedSubject : (statSubjects[0] || {}).id;

  const PERIODS = [
    { key:'7',  label:'Неделя',   days:7 },
    { key:'30', label:'Месяц',    days:30 },
    { key:'90', label:'3 месяца', days:90 },
    { key:'0',  label:'Всё время',days:null },
  ];
  let period = '30';

  /* ── KPI ────────────────────────────────────────────────────── */
  function kpiHTML(days) {
    const k = C.kpi(S, subj);
    const tns = C.taskNumberStats(S, days, subj);
    const solved = tns.reduce((s, t) => s + t.attempts, 0);
    const correct = tns.reduce((s, t) => s + t.correct, 0);
    const seconds = tns.reduce((s, t) => s + t.seconds, 0);
    const att = C.attendance(S, days || 3650, subj);
    const series = C.mockSeries(S, subj);
    const last = series[series.length - 1];
    const delta = series.length > 1 ? last.score - series[series.length - 2].score : null;

    const cells = [
      { v: last ? last.score : '—', e: delta != null ? (delta >= 0 ? '↑ ' + delta : '↓ ' + Math.abs(delta)) : '',
        s:'баллов на пробнике', c:'k-green' },
      { v: solved ? Math.round((correct / solved) * 100) + '%' : '—', s:'верных ответов', c:'k-blue' },
      { v: solved, s:'задач решено', c:'k-violet' },
      { v: C.fmtDur(seconds), s:'времени за задачами', c:'k-amber' },
    ];
    return `<section class="kpis">${cells.map(x =>
      `<div class="kpi ${x.c}"><b>${x.v}${x.e ? ` <em class="csp-u-043">${x.e}</em>` : ''}</b>
        <span>${x.s}</span></div>`).join('')}</section>`;
  }

  /* ── график пробников ───────────────────────────────────────── */
  function mockHTML() {
    const series = C.mockSeries(S, subj);
    const goal = C.goalProgress(S, subj);
    if (series.length < 2) return `<div class="card"><div class="head"><h2>Динамика пробников</h2></div>
      ${UI.empty('Мало данных', 'График появится после второго пробника.')}</div>`;

    const W = 620, H = 240, L = 46, R = 12, T = 20, B = 34;
    const lo = 30, hi = 100;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const x = i => L + i * ((W - L - R) / (series.length - 1));
    const pts = series.map((m, i) => [x(i), y(m.score)]);
    const line = pts.map(p => p.join(',')).join(' L');
    const area = `M${line} L${pts[pts.length-1][0]},${H - B} L${pts[0][0]},${H - B} Z`;
    const grid = [100, 85, 70, 55, 40].map(v =>
      `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="var(--line)"/>
       <text x="6" y="${y(v) + 4}" fill="var(--muted)" font-size="11">${v}</text>`).join('');
    const gy = goal ? y(goal.target) : null;

    return `<div class="card">
      <div class="head"><div><h2>Динамика пробников</h2>
        <div class="hint">Тестовый балл ЕГЭ по ${series.length} ${C.plural(series.length,'пробнику','пробникам','пробникам')}</div></div></div>
      <svg class="csp-u-071" viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--brand)" stop-opacity=".28"/>
          <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        ${gy != null ? `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="var(--green)"
            stroke-width="1.5" stroke-dasharray="5 4"/>
          <text x="${W - R - 60}" y="${gy - 6}" fill="var(--green)" font-size="11" font-weight="600">цель ${goal.target}</text>` : ''}
        <path d="${area}" fill="url(#g)"/>
        <path d="M${line}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/>
        ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length-1 ? 6 : 4.5}"
          fill="${i === pts.length-1 ? 'var(--brand)' : 'var(--panel)'}" stroke="var(--brand)" stroke-width="2.5"/>`).join('')}
        ${series.map((m, i) => `<text x="${x(i)}" y="${H - 10}" fill="var(--muted)" font-size="11"
          text-anchor="middle">${C.fmtDate(m.date)}</text>`).join('')}
      </svg>
      <div class="heat-scale">
        <span>первичный балл последнего: <b>${series[series.length-1].primary} из ${series[series.length-1].primaryMax}</b></span>
        <span>рост за период: <b class="csp-u-010">+${series[series.length-1].score - series[0].score}</b></span>
      </div>
    </div>`;
  }

  /* ── темы ───────────────────────────────────────────────────── */
  function topicsHTML() {
    const list = C.topicMastery(S, subj);
    if (!list.length) return `<div class="card"><div class="head"><h2>Темы</h2></div>
      ${UI.empty('Нет данных', 'Появятся после решённых задач.')}</div>`;
    return `<div class="card">
      <div class="head"><div><h2>Темы</h2>
        <div class="hint">Процент верных и изменение за месяц</div></div></div>
      ${list.map(m => `
        <div class="csp-u-048">
          <div class="csp-u-025">
            <b>${m.topic.name}</b>
            <span class="muted csp-u-070">${m.percent}%
              ${m.delta != null ? `<em class="${m.delta >= 0 ? 'delta-positive' : 'delta-negative'}">${m.delta >= 0 ? '↑' : '↓'} ${Math.abs(m.delta)}</em>` : ''}
            </span>
          </div>
          ${UI.bar(m.percent, UI.pctColor(m.percent))}
          <div class="muted small csp-u-057">${m.n} ${C.plural(m.n,'решение','решения','решений')} · ${C.fmtDurShort(m.seconds)}</div>
        </div>`).join('')}
    </div>`;
  }

  /* ── активность ─────────────────────────────────────────────── */
  function heatHTML() {
    const days = C.dailyActivity(S, 28, subj);
    const max = Math.max(1, ...days.map(d => d.solved));
    const lvl = n => !n ? 0 : Math.max(1, Math.min(4, Math.ceil(4 * n / max)));
    return `<div class="card">
      <div class="head"><div><h2>Активность</h2>
        <div class="hint">Решённые задачи за 4 недели</div></div>
        <span class="muted small">серия: ${C.streak(S, subj)} ${C.plural(C.streak(S, subj),'день','дня','дней')}</span></div>
      <div class="heat">${days.map(d =>
        `<i class="activity-${lvl(d.solved)}" title="${C.fmtDate(d.date)}: ${d.solved} ${
          C.plural(d.solved,'задача','задачи','задач')}, ${C.fmtDurShort(d.seconds)}"></i>`).join('')}</div>
      <div class="heat-scale">меньше
        <i class="csp-u-007"></i>
        <i class="csp-u-001"></i>
        <i class="csp-u-002"></i>
        <i class="csp-u-005"></i>больше
        <span class="csp-u-051">всего ${days.reduce((s,d)=>s+d.solved,0)} задач</span>
      </div></div>`;
  }

  /* ── посещаемость ───────────────────────────────────────────── */
  function attendanceHTML(days) {
    const a = C.attendance(S, days || 3650, subj);
    if (!a.total) return `<div class="card"><div class="head"><h2>Посещаемость</h2></div>
      ${UI.empty('Занятий за период нет', '')}</div>`;
    const dash = 314, off = dash - dash * (a.percent / 100);
    return `<div class="card">
      <div class="head"><div><h2>Посещаемость</h2>
        <div class="hint">${a.total} ${C.plural(a.total,'занятие','занятия','занятий')} за период</div></div></div>
      <div class="csp-u-016">
        <div class="ring">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="12"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--green)" stroke-width="12"
              stroke-linecap="round" stroke-dasharray="${dash}" stroke-dashoffset="${off}"/>
          </svg>
          <div class="lbl"><b>${a.percent}%</b><span>посещений</span></div>
        </div>
        <div class="csp-u-030">
          <div class="csp-u-024"><span class="muted">Проведено</span><b>${a.done}</b></div>
          <div class="csp-u-024"><span class="muted">Перенесено</span><b>${a.moved}</b></div>
          <div class="csp-u-024"><span class="muted">Пропущено</span><b>${a.missed}</b></div>
          <div class="csp-u-024"><span class="muted">Часов занятий</span><b>${a.hours}</b></div>
        </div>
      </div></div>`;
  }

  /* ── сводка по номерам заданий: время + процент ─────────────── */
  function tnsHTML(days) {
    const list = C.taskNumberStats(S, days, subj);
    if (!list.length) return `<section class="card"><div class="head"><h2>По номерам заданий · ${UI.esc(C.subject(subj).name)}</h2></div>
      ${UI.empty('Нет решённых задач за период', '')}</section>`;

    const maxSec = Math.max(...list.map(t => t.seconds));
    const bars = list.map(t => {
      const cls = t.percent >= 80 ? 'high' : t.percent >= 60 ? 'mid' : 'low';
      return `<div class="vbar" title="№${t.number}: ${C.fmtDur(t.seconds)}, ${t.percent}% верных">
        <span class="p ${UI.pctClass(t.percent)}">${t.percent}%</span>
        <div class="track"><div class="col ${cls} height-${Math.round(Math.round(t.seconds / maxSec * 100) / 5) * 5}"></div></div>
        <span class="n">№${t.number}</span>
        <span class="n csp-u-032">${C.fmtDurShort(t.seconds)}</span>
      </div>`;
    }).join('');

    const rows = list.slice().sort((a, b) => b.seconds - a.seconds).map(t => `
      <tr>
        <td><b>№${t.number}</b></td>
        <td class="muted small">${UI.esc((t.topic || {}).name || '')}</td>
        <td class="num">${C.fmtDurShort(t.seconds)}</td>
        <td class="num ${UI.pctClass(t.percent)}">${t.percent}%</td>
        <td class="num muted">${t.firstTryPercent}%</td>
        <td class="num muted">${C.fmtDurShort(t.avgSeconds)}</td>
        <td class="num muted">${t.attempts}</td>
      </tr>`).join('');

    return `<section class="card">
      <div class="head"><div><h2>По номерам заданий · ${UI.esc(C.subject(subj).name)}</h2>
        <div class="hint">Высота столбца — потраченное время, цвет — процент верных</div></div></div>
      <div class="vbars">${bars}</div>
      <table class="csp-u-056">
        <thead><tr>
          <th>Номер</th><th>Тема</th><th class="num">Время</th><th class="num">Верных</th>
          <th class="num">С 1-й</th><th class="num">Среднее</th><th class="num">Решений</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="note n-grey csp-u-054">
        Это <b>TaskNumberStats</b> из доменной модели. Время — только активное,
        поэтому строка читается как «№${list[0].number} решался ${C.fmtDur(list[0].seconds)}, ${list[0].percent}% верных».
      </div>
    </section>`;
  }

  /* ── последние работы ───────────────────────────────────────── */
  function recentHTML() {
    const rows = C.attemptsOf(S, subj)
      .filter(a => C.isDone(a) && a.assignmentId)
      .sort((a, b) => new Date(C.attemptDate(b)) - new Date(C.attemptDate(a)))
      .slice(0, 8)
      .map(a => {
        const t = C.task(a.taskId);
        const asg = C.assignment(a.assignmentId);
        const st = a.status === 'submitted' ? '<span class="badge b-amber">на проверке</span>'
          : a.isCorrect ? '<span class="badge b-green">верно</span>'
          : '<span class="badge b-red">неверно</span>';
        return `<tr>
          <td>№${t ? t.number : '?'} · ${UI.esc(t ? t.title : '')}</td>
          <td class="muted small">${asg ? UI.esc(asg.title) : '—'}</td>
          <td class="muted small">${C.fmtDate(C.attemptDate(a))}</td>
          <td>${st}</td>
          <td class="num muted">${C.fmtDurShort(a.activeSeconds)}</td>
        </tr>`;
      }).join('');
    if (!rows) return '';
    return `<section class="card csp-u-054">
      <div class="head"><h2>Последние работы</h2><a href="homework.html">все д/з</a></div>
      <table><thead><tr><th>Задача</th><th>Задание</th><th>Дата</th><th>Итог</th><th class="num">Время</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
  }

  /* ── сборка ─────────────────────────────────────────────────── */
  function render() {
    if (!subj) {
      document.getElementById('content').innerHTML = `<section class="card">${UI.empty('Статистики пока нет','Решите первую задачу в <a href="student-bank.html">банке заданий</a>.')}</section>`;
      return;
    }
    const days = (PERIODS.find(p => p.key === period) || {}).days;
    document.getElementById('content').innerHTML = `
      ${kpiHTML(days)}
      <section class="cols c2w">${mockHTML()}${topicsHTML()}</section>
      <section class="cols c2">${heatHTML()}${attendanceHTML(days)}</section>
      ${tnsHTML(days)}
      ${recentHTML()}`;
  }

  const periodSwitcher = `<div class="filters csp-u-059">${PERIODS.map(p =>
    `<button data-p="${p.key}" class="${p.key === period ? 'on' : ''}">${p.label}</button>`).join('')}</div>`;
  const statSubjectSwitcher = statSubjects.length < 2 ? '' : `<div class="filters csp-u-059">${statSubjects.map(s =>
    `<button data-stat-subj="${s.id}" class="${s.id === subj ? 'on' : ''}">${UI.esc(s.short || s.name)}</button>`).join('')}</div>`;
  const switcher = `<div class="csp-u-020">
    ${statSubjectSwitcher}${periodSwitcher}</div>`;

  UI.page({
    session: ses,
    active: asParent ? 'stats' : 'stats',
    head:{ title:'Статистика',
      sub: (ses.role === 'student' ? 'Всё считается из решённых задач'
        : UI.esc(stUser.name) + (asParent ? ' · только просмотр' : ' · глазами репетитора'))
        + (statSubjects.length ? ' · ' + statSubjects.map(x => x.name).join(', ') : ''),
      actions: switcher },
    body:'',
  });
  document.querySelectorAll('[data-stat-subj]').forEach(button => button.addEventListener('click', () => {
    subj = button.dataset.statSubj;
    document.querySelectorAll('[data-stat-subj]').forEach(x => x.classList.toggle('on', x.dataset.statSubj === subj));
    render();
  }));
  document.querySelectorAll('[data-p]').forEach(b =>
    b.addEventListener('click', () => {
      period = b.dataset.p;
      document.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x.dataset.p === period));
      render();
    }));
  render();
})();
