/* ═══════════════════════════════════════════════════════════════════
   ОБОЛОЧКА: сайдбар по роли вошедшего, хелперы вёрстки
   ═══════════════════════════════════════════════════════════════════ */
window.UI = (function () {
  const SUBJ_KEY = 'token.subject';

  function qs(name) { return new URLSearchParams(location.search).get(name); }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ── навигация по ролям ──────────────────────────────────────── */
  function navFor(s) {
    const C = window.Core;
    if (s.role === 'tutor') {
      const q = C.reviewQueue(s.tutorId).length;
      return [
        { key:'today',    href:'/tutor.html',       ico:'◧', label:'Сегодня' },
        { key:'lesson',   href:'/lesson.html',      ico:'▶', label:'Занятие' },
        { key:'check',    href:'/tutor-check.html', ico:'✓', label:'Проверка', pill:q || null },
        { key:'students', href:'/students.html',    ico:'☺', label:'Ученики' },
        { key:'groups',   href:'/groups.html',      ico:'⛁', label:'Группы' },
        { key:'invites',  href:'/invites.html',     ico:'⇗', label:'Приглашения' },
        { key:'bank',     href:'/bank.html',        ico:'▤', label:'Банк задач' },
      ];
    }
    if (s.role === 'parent') {
      return [{ key:'progress', href:'/parent.html', ico:'◧', label:'Прогресс ребёнка' }];
    }
    const overdue = C.assignmentsOf(s.studentId).filter(a => a.status === 'overdue').length;
    return [
      { key:'home',    href:'/index.html',    ico:'◧', label:'Главная' },
      { key:'lesson',  href:'/lesson.html',   ico:'▶', label:'Занятие' },
      { key:'hw',      href:'/homework.html', ico:'✎', label:'Д/З', pill:overdue || null },
      { key:'practice', href:'/student-bank.html', ico:'▤', label:'Банк заданий' },
      { key:'stats',   href:'/stats.html',    ico:'↗', label:'Статистика' },
    ];
  }

  function sidebar(s, active) {
    const items = navFor(s).map(i => `
      <a href="${i.href}" class="${i.key === active ? 'active' : ''}">
        <span class="ico">${i.ico}</span>${i.label}
        ${i.pill ? `<span class="pill">${i.pill}</span>` : ''}
      </a>`).join('');

    return `
      <aside class="sidebar">
        <div class="logo">Token<small>${esc(Auth.ROLES[s.role].label)}</small></div>
        <nav class="nav">${items}</nav>
        <div class="side-foot">
          ${s.role === 'student' ? '<a href="/account.html" class="profile-link" aria-label="Открыть профиль">' : ''}<div class="rolepick csp-rolepick">
            ${avatar(s.user.name, s.role === 'tutor' ? 'blue' : '')}
            <div class="csp-rolecopy">
              <div class="csp-role-name">${esc(s.user.name)}</div>
              <div class="muted csp-role-email">${esc(s.user.email)}</div>
            </div>
          </div>${s.role === 'student' ? '</a>' : ''}
          <a href="#" class="logout" id="do-logout"><span class="ico">⏻</span>Выйти</a>
        </div>
      </aside>`;
  }

  /* ── сборка страницы ─────────────────────────────────────────── */
  function page(opts) {
    const s = opts.session;
    document.body.innerHTML = `
      <div class="app">
        ${sidebar(s, opts.active)}
        <main class="main">
          ${opts.head ? head(opts.head) : ''}
          <div id="content">${opts.body || ''}</div>
        </main>
      </div>
      ${devBar()}`;
    const out = document.getElementById('do-logout');
    if (out) out.addEventListener('click', e => { e.preventDefault(); Auth.logout(); });
  }

  function head(h) {
    return `<div class="top">
      <h1>${h.title}${h.sub ? `<small>${h.sub}</small>` : ''}</h1>
      <div class="head-acts">${h.actions || ''}</div>
    </div>`;
  }

  function devBar() {
    return `<div class="demo">
      <b>Token</b> · данные на сервере, сессия в httpOnly-куке
    </div>`;
  }

  /* ── переключатель предмета ──────────────────────────────────── */
  function subjectId(studentId) {
    const list = Core.subjectsOf(studentId);
    if (!list.length) return null;
    const want = qs('subject') || localStorage.getItem(SUBJ_KEY);
    return list.some(x => x.id === want) ? want : list[0].id;
  }
  function subjectSwitcher(studentId, current) {
    const list = Core.subjectsOf(studentId);
    if (list.length < 2) return '';
    return `<div class="filters filters-compact">${list.map(x =>
      `<button data-subj="${x.id}" class="${x.id === current ? 'on' : ''}">${esc(x.short || x.name)}</button>`
    ).join('')}</div>`;
  }
  function bindSubjectSwitcher(handler) {
    document.querySelectorAll('[data-subj]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.dataset.subj;
        localStorage.setItem(SUBJ_KEY, id);
        document.querySelectorAll('[data-subj]').forEach(x => x.classList.toggle('on', x.dataset.subj === id));
        handler(id);
      }));
  }
  function subjectTag(s) {
    if (!s) return '';
    const cls = { blue:'b-blue', violet:'b-violet', green:'b-green', amber:'b-amber' }[s.color] || 'b-grey';
    return `<span class="badge ${cls}">${esc(s.short || s.name)}</span>`;
  }

  /* ── мелкие хелперы ──────────────────────────────────────────── */
  function badge(status) {
    const m = Core.ASSIGNMENT_STATUS[status];
    return m ? `<span class="badge ${m.cls}">${m.label}</span>` : '';
  }
  function empty(title, text) {
    return `<div class="empty"><b>${title}</b>${text || ''}</div>`;
  }
  function bar(percent, color) {
    const p = Math.max(0, Math.min(100, percent || 0));
    const width = Math.round(p / 5) * 5;
    const colorClass = color === 'var(--green)' ? 'bar-green'
      : color === 'var(--amber)' ? 'bar-amber'
      : color === 'var(--red)' ? 'bar-red' : '';
    return `<div class="bar"><i class="bar-fill width-${width} ${colorClass}"></i></div>`;
  }
  function pctColor(p) {
    if (p == null) return 'var(--muted)';
    if (p >= 80) return 'var(--green)';
    if (p >= 60) return 'var(--amber)';
    return 'var(--red)';
  }
  function pctClass(p) {
    if (p == null) return 'pct-muted';
    if (p >= 80) return 'pct-green';
    if (p >= 60) return 'pct-amber';
    return 'pct-red';
  }
  function difficultyLabel(value) {
    return ({ 1:'Easy', 2:'Medium', 3:'Hard' })[Number(value)] || 'Medium';
  }
  function difficultyHTML(value) {
    const level = ({ 1:'easy', 2:'medium', 3:'hard' })[Number(value)] || 'medium';
    return `<span class="difficulty ${level}">${difficultyLabel(value)}</span>`;
  }
  function avatar(name, cls) {
    const ini = String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `<div class="avatar ${cls || ''}">${ini}</div>`;
  }

  const LINK_TYPE = {
    call:     { label:'созвон',   cls:'b-blue',   ico:'▶' },
    board:    { label:'доска',    cls:'b-violet', ico:'▦' },
    material: { label:'материал', cls:'b-grey',   ico:'▤' },
  };

  function linkRow(l, i, editable) {
    const t = LINK_TYPE[l.type] || LINK_TYPE.material;
    return `<a href="${esc(l.url)}" target="_blank" rel="noopener">
      <span class="ty ${t.cls}">${t.label}</span>
      <span class="grow">${esc(l.label)}</span>
      <span class="muted small">открыть ↗</span>
      ${editable ? `<button class="btn sm grey rm-link" data-i="${i}">убрать</button>` : ''}
    </a>`;
  }

  function copy(text, btn) {
    const done = () => { if (!btn) return; const t = btn.textContent; btn.textContent = 'скопировано'; setTimeout(() => btn.textContent = t, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => prompt('Скопируйте ссылку:', text));
    } else { prompt('Скопируйте ссылку:', text); }
  }

  /* дата-время для input[type=datetime-local] */
  function dtLocal(d) {
    const x = new Date(d);
    const p = n => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
  }

  return { page, badge, empty, bar, pctColor, pctClass, avatar, esc, attr, linkRow, LINK_TYPE,
           qs, subjectId, subjectSwitcher, bindSubjectSwitcher, subjectTag,
           difficultyLabel, difficultyHTML, copy, dtLocal };
})();
