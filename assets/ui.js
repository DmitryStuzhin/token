/* ═══════════════════════════════════════════════════════════════════
   ОБЩАЯ ОБОЛОЧКА: сайдбар по роли, переключатель роли, хелперы вёрстки
   ═══════════════════════════════════════════════════════════════════ */
window.UI = (function () {
  const ROLE_KEY = 'arcs.role';

  /* активный ученик прототипа */
  const STUDENT = 's-anna';
  const TUTOR = 'tp-dm';
  const PARENT = 'u-elena';

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }
  function role() {
    const r = qs('role') || localStorage.getItem(ROLE_KEY) || 'student';
    return ['student', 'tutor', 'parent', 'admin'].includes(r) ? r : 'student';
  }
  function setRole(r) {
    localStorage.setItem(ROLE_KEY, r);
    location.href = HOME[r];
  }

  const HOME = {
    student: 'index.html',
    tutor:   'tutor.html',
    parent:  'parent.html',
    admin:   'admin.html',
  };

  const ROLE_LABEL = { student:'Ученик', tutor:'Репетитор', parent:'Родитель', admin:'Админ' };

  function navFor(r) {
    const C = window.Core;
    if (r === 'tutor') {
      const q = C.reviewQueue(TUTOR).length;
      return [
        { key:'today',    href:'tutor.html',                  ico:'◧', label:'Сегодня' },
        { key:'check',    href:'tutor-check.html',            ico:'✓', label:'Проверка', pill:q || null },
        { key:'lesson',   href:'lesson.html?role=tutor',      ico:'▶', label:'Занятие' },
        { key:'students', href:'tutor.html#students',         ico:'☺', label:'Ученики' },
      ];
    }
    if (r === 'parent') {
      return [
        { key:'progress', href:'parent.html',                 ico:'◧', label:'Прогресс ребёнка' },
        { key:'stats',    href:'stats.html?role=parent',      ico:'▤', label:'Статистика' },
        { key:'pay',      href:'parent.html#pay',             ico:'₽', label:'Абонемент' },
      ];
    }
    if (r === 'admin') {
      return [
        { key:'links',  href:'admin.html#links',  ico:'⇄', label:'Привязки' },
        { key:'subs',   href:'admin.html#subs',   ico:'₽', label:'Абонементы' },
        { key:'bank',   href:'admin.html#bank',   ico:'▤', label:'Банк задач' },
      ];
    }
    const overdue = C.assignmentsOf(STUDENT).filter(a => a.status === 'overdue').length;
    return [
      { key:'home',    href:'index.html',    ico:'◧', label:'Главная' },
      { key:'lesson',  href:'lesson.html',   ico:'▶', label:'Занятие' },
      { key:'hw',      href:'homework.html', ico:'✎', label:'Д/З', pill:overdue || null },
      { key:'stats',   href:'stats.html',    ico:'▤', label:'Статистика' },
      { key:'account', href:'account.html',  ico:'◔', label:'Аккаунт' },
    ];
  }

  function sidebar(r, active) {
    const items = navFor(r).map(i => `
      <a href="${i.href}" class="${i.key === active ? 'active' : ''}">
        <span class="ico">${i.ico}</span>${i.label}
        ${i.pill ? `<span class="pill">${i.pill}</span>` : ''}
      </a>`).join('');

    const opts = Object.keys(ROLE_LABEL)
      .map(k => `<option value="${k}" ${k === r ? 'selected' : ''}>${ROLE_LABEL[k]}</option>`).join('');

    return `
      <aside class="sidebar">
        <div class="logo">arcs<span>.studio</span><small>${ROLE_LABEL[r]}</small></div>
        <nav class="nav">${items}</nav>
        <div class="side-foot">
          <div class="rolepick">
            <label>Роль в прототипе</label>
            <select id="rolepick">${opts}</select>
          </div>
          <a href="#" class="logout"><span class="ico">⏻</span>Выйти</a>
        </div>
      </aside>`;
  }

  /* ── сборка страницы ─────────────────────────────────────────── */
  function page(opts) {
    const r = opts.role || role();
    document.body.innerHTML = `
      <div class="app">
        ${sidebar(r, opts.active)}
        <main class="main">
          ${opts.head ? head(opts.head) : ''}
          <div id="content">${opts.body || ''}</div>
        </main>
      </div>
      ${demoBar()}`;
    const sel = document.getElementById('rolepick');
    if (sel) sel.addEventListener('change', e => setRole(e.target.value));
    const reset = document.getElementById('reset-demo');
    if (reset) reset.addEventListener('click', e => { e.preventDefault(); DB.reset(); });
  }

  function head(h) {
    return `<div class="top">
      <h1>${h.title}${h.sub ? `<small>${h.sub}</small>` : ''}</h1>
      <div class="banner-acts">${h.actions || ''}</div>
    </div>`;
  }

  function demoBar() {
    return `<div class="demo">
      <b>Прототип.</b> Данные из <code>assets/db.js</code>, ответы сохраняются локально.
      <button id="reset-demo">сбросить</button>
    </div>`;
  }

  /* ── мелкие хелперы ──────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  function linkRow(l) {
    const t = LINK_TYPE[l.type] || LINK_TYPE.material;
    const ext = l.url && l.url !== '#' ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${l.url || '#'}"${ext}>
      <span class="ty ${t.cls}">${t.label}</span>
      <span class="grow">${esc(l.label)}</span>
      <span class="muted small">${l.url && l.url !== '#' ? 'открыть ↗' : 'нет ссылки'}</span>
    </a>`;
  }

  return { role, setRole, page, badge, empty, bar, pctColor, avatar, esc,
           linkRow, LINK_TYPE, STUDENT, TUTOR, PARENT, HOME, qs };
})();
