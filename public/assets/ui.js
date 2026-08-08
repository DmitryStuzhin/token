/* ═══════════════════════════════════════════════════════════════════
   ОБОЛОЧКА: сайдбар по роли вошедшего, хелперы вёрстки
   ═══════════════════════════════════════════════════════════════════ */
window.UI = (function () {
  const SUBJ_KEY = 'token.subject';

  function qs(name) { return new URLSearchParams(location.search).get(name); }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ── навигация по ролям ──────────────────────────────────────── */
  function navFor(s) {
    const C = window.Core;
    if (s.role === 'tutor') {
      const q = C.reviewQueue(s.tutorId).length;
      return [
        { key:'today',   href:'tutor.html',             ico:'◧', label:'Сегодня' },
        { key:'check',   href:'tutor-check.html',       ico:'✓', label:'Проверка', pill:q || null },
        { key:'groups',  href:'tutor.html#groups',      ico:'⛁', label:'Группы' },
        { key:'students',href:'tutor.html#students',    ico:'☺', label:'Ученики' },
        { key:'invites', href:'tutor.html#invites',     ico:'⇗', label:'Приглашения' },
        { key:'bank',    href:'bank.html',              ico:'▤', label:'Банк задач' },
      ];
    }
    if (s.role === 'parent') {
      return [{ key:'progress', href:'parent.html', ico:'◧', label:'Прогресс ребёнка' }];
    }
    const overdue = C.assignmentsOf(s.studentId).filter(a => a.status === 'overdue').length;
    return [
      { key:'home',    href:'index.html',    ico:'◧', label:'Главная' },
      { key:'lesson',  href:'lesson.html',   ico:'▶', label:'Занятие' },
      { key:'hw',      href:'homework.html', ico:'✎', label:'Д/З', pill:overdue || null },
      { key:'stats',   href:'stats.html',    ico:'▤', label:'Статистика' },
      { key:'account', href:'account.html',  ico:'◔', label:'Профиль' },
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
          <div class="rolepick" style="display:flex;align-items:center;gap:10px">
            ${avatar(s.user.name, s.role === 'tutor' ? 'blue' : '')}
            <div style="min-width:0;flex:1">
              <div style="font-weight:650;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.user.name)}</div>
              <div class="muted" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.user.email)}</div>
            </div>
          </div>
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
    return `<div class="filters" style="margin:0">${list.map(x =>
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
    return `<div class="bar"><i style="width:${p}%${color ? ';background:' + color : ''}"></i></div>`;
  }
  function pctColor(p) {
    if (p == null) return 'var(--muted)';
    if (p >= 80) return 'var(--green)';
    if (p >= 60) return 'var(--amber)';
    return 'var(--red)';
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
      ${editable ? `<button class="btn sm grey rm-link" data-i="${i}"
         onclick="event.preventDefault();event.stopPropagation();">убрать</button>` : ''}
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

  return { page, badge, empty, bar, pctColor, avatar, esc, linkRow, LINK_TYPE,
           qs, subjectId, subjectSwitcher, bindSubjectSwitcher, subjectTag, copy, dtLocal };
})();
