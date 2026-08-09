(function () {
  const ses = Auth.require();
  if (!ses) return;
  const C = Core;

  const isStudent = ses.role === 'student';
  const S = ses.studentId;                       /* null у репетитора и родителя */
  const code = (UI.qs('code') || '').trim();
  const inv = code ? C.inviteByCode(code) : null;
  const st = C.inviteState(inv);
  const target = C.inviteTarget(inv);
  const joined = inv && isStudent && C.inviteAlreadyJoined(inv, S);
  const mine = inv && ses.tutorId && inv.tutorId === ses.tutorId;

  const wrap = inner => `<div class="csp-u-062">${inner}</div>`;
  const backHref = ses.home;

  /* ── что даёт приглашение ───────────────────────────────────── */
  function whatHTML() {
    if (!target) return '';
    if (target.kind === 'group') {
      const g = target.group;
      const stats = C.groupStats(g.id);
      return `
        <div class="field"><div class="k">Вступление в группу</div>
          <div class="v csp-u-040">${UI.esc(g.title)}</div></div>
        <div class="field"><div class="k">Предмет</div>
          <div class="v">${UI.esc(target.subject.name)} · уровень: ${UI.esc(g.level)}</div></div>
        ${g.schedule ? `<div class="field"><div class="k">Расписание</div>
          <div class="v">${UI.esc(g.schedule)}</div></div>` : ''}
        <div class="field"><div class="k">Репетитор</div>
          <div class="v">${UI.esc(target.tutor.user.name)}</div></div>
        <div class="field csp-u-045"><div class="k">Мест</div>
          <div class="v">${stats.size} из ${g.capacity} занято${
            target.seatsLeft != null ? ' · по ссылке осталось ' + target.seatsLeft : ''}</div></div>`;
    }
    if (target.kind === 'enrollment') {
      return `
        <div class="field"><div class="k">Индивидуальные занятия</div>
          <div class="v csp-u-040">${UI.esc(target.subject.name)}</div></div>
        <div class="field"><div class="k">Репетитор</div>
          <div class="v">${UI.esc(target.tutor.user.name)}${target.tutor.profile.yearsExp
            ? ' · ' + target.tutor.profile.yearsExp + ' ' +
              C.plural(target.tutor.profile.yearsExp,'год','года','лет') + ' опыта' : ''}</div></div>
        <div class="field csp-u-045"><div class="k">Что появится в кабинете</div>
          <div class="v csp-u-044">Расписание занятий, домашние задания,
            статистика по этому предмету</div></div>`;
    }
    if (target.kind === 'guardian') {
      return `<div class="field csp-u-045"><div class="k">Доступ родителя</div>
        <div class="v csp-u-044">Кабинет родителя ещё не собран —
          такие ссылки пока не принимаются.</div></div>`;
    }
    return '';
  }

  /* ── экраны ─────────────────────────────────────────────────── */
  function askCode() {
    return wrap(`<section class="card">
      <div class="head"><h2>Код приглашения</h2></div>
      <p class="muted small csp-u-047">
        Ссылку присылает репетитор. Если у вас только код — введите его здесь.</p>
      <div class="answer">
        <input class="csp-u-069" id="code" placeholder="например DM-7K2P">
        <button class="btn" id="go">Открыть</button>
      </div>
    </section>`);
  }

  function badInvite() {
    return wrap(`<section class="card">
      <div class="head"><h2>Приглашение недоступно</h2>
        <span class="badge b-red">${UI.esc(st.label)}</span></div>
      <div class="verdict v-no">Код <b>${UI.esc(code)}</b> — ${UI.esc(st.label.toLowerCase())}.</div>
      <p class="muted small csp-u-054">
        Попросите репетитора выпустить новую ссылку: старая могла истечь,
        исчерпать лимит переходов или быть отозвана.</p>
      <a class="btn ghost csp-u-054" href="${backHref}">В кабинет</a>
    </section>`);
  }

  function alreadyIn() {
    return wrap(`<section class="card">
      <div class="head"><h2>Вы уже присоединены</h2><span class="badge b-green">активно</span></div>
      ${whatHTML()}
      <a class="btn csp-u-055" href="index.html">Открыть кабинет</a>
    </section>`);
  }

  /* репетитор (или родитель) открыл ссылку для ученика */
  function preview() {
    const url = C.inviteUrl(inv.code);
    const left = inv.maxUses == null ? '∞' : Math.max(0, inv.maxUses - inv.usedCount);
    return wrap(`
      <section class="card">
        <div class="head">
          <div><h2>${mine ? 'Ваша ссылка-приглашение' : 'Приглашение'}</h2>
            <div class="hint">Так её увидит ученик</div></div>
          ${target.subject ? UI.subjectTag(target.subject) : ''}
        </div>
        ${inv.note ? `<div class="note n-blue csp-u-049">${UI.esc(inv.note)}</div>` : ''}
        ${whatHTML()}
      </section>

      <section class="card csp-u-054">
        <div class="head"><h2>Ссылка</h2>
          <span class="muted small">переходов: ${inv.usedCount} · осталось: ${left}</span></div>
        <div class="editor csp-u-046">
          <div class="ehead"><span>код ${UI.esc(inv.code)}</span>
            <span>${inv.expiresAt ? 'до ' + C.fmtDate(inv.expiresAt) : 'бессрочно'}</span></div>
          <pre class="csp-u-064">${UI.esc(url)}</pre>
        </div>
        <div class="csp-u-022">
          <button class="btn sm" id="copy">Скопировать ссылку</button>
          <a class="btn sm ghost" href="login.html?force=1&next=${encodeURIComponent('invite.html?code=' + inv.code)}">
            Войти учеником и присоединиться</a>
          <a class="btn sm grey" href="${backHref}">Назад в кабинет</a>
        </div>
      </section>

      <div class="note n-grey csp-u-054">
        Вы вошли как <b>${UI.esc(Auth.ROLES[ses.role].label.toLowerCase())}</b>, поэтому присоединиться
        по этой ссылке нельзя — приглашение принимает ученик. Чтобы проверить сценарий целиком,
        зарегистрируйте отдельный аккаунт ученика и откройте ссылку под ним.
      </div>`);
  }

  /* ученик: можно присоединиться */
  function accept() {
    const prof = C.student(S);
    return wrap(`
      <section class="card">
        <div class="head">
          <div><h2>Приглашение от ${UI.esc(target.tutor ? target.tutor.user.name : '—')}</h2>
            <div class="hint">код ${UI.esc(inv.code)}${
              inv.expiresAt ? ' · действует до ' + C.fmtDate(inv.expiresAt) : ''}</div></div>
          ${target.subject ? UI.subjectTag(target.subject) : ''}
        </div>
        ${inv.note ? `<div class="note n-blue csp-u-049">${UI.esc(inv.note)}</div>` : ''}
        ${whatHTML()}
      </section>

      <section class="card csp-u-054">
        <div class="head"><h2>Вы входите как</h2>
          <a href="login.html?force=1&next=${encodeURIComponent('invite.html?code=' + inv.code)}">сменить аккаунт</a></div>
        <div class="row">
          ${UI.avatar(ses.user.name)}
          <span class="grow"><span class="t">${UI.esc(ses.user.name)}</span>
            <span class="s">${prof ? prof.grade + ' класс' : ''}${
              prof && prof.school ? ' · ' + UI.esc(prof.school) : ''} · ${UI.esc(ses.user.email)}</span></span>
        </div>
        <div class="answer">
          <span class="muted small csp-u-028">Привязка создаётся сразу и появится у репетитора.</span>
          <button class="btn" id="accept">Присоединиться</button>
        </div>
        <div id="out"></div>
      </section>`);
  }

  function body() {
    if (!code) return askCode();
    if (!inv || !st.ok) return badInvite();
    if (joined) return alreadyIn();
    if (!isStudent) return preview();
    if (inv.kind === 'guardian') return preview();
    return accept();
  }

  UI.page({
    session: ses,
    active: isStudent ? 'home' : 'invites',
    head:{ title:'Приглашение', sub:'Присоединение к репетитору или группе по ссылке' },
    body: body(),
  });

  const go = document.getElementById('go');
  if (go) go.addEventListener('click', () => {
    const v = document.getElementById('code').value.trim();
    if (v) location.href = 'invite.html?code=' + encodeURIComponent(v);
  });

  const cp = document.getElementById('copy');
  if (cp) cp.addEventListener('click', () => UI.copy(C.inviteUrl(inv.code), cp));

  const acc = document.getElementById('accept');
  if (acc) acc.addEventListener('click', async () => {
    const out = document.getElementById('out');
    acc.disabled = true;
    let res;
    try { res = await Api.acceptInvite(code); }
    catch (e) { acc.disabled = false; out.innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`; return; }
    const t = res.target;
    out.innerHTML = `<div class="verdict v-ok">
      Готово. ${t.kind === 'group' ? 'Вы в группе «' + UI.esc(t.group.title) + '»'
        : 'Занятия по предмету «' + UI.esc(t.subject.name) + '» добавлены'}.
      <a href="index.html">открыть кабинет →</a></div>`;
  });
})();
