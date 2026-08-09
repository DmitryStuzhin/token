(function () {
  const next = UI.qs('next');
  const already = Auth.session();
  if (already && !UI.qs('force')) { location.href = next ? '/' + next : already.home; return; }

  let mode = UI.qs('mode') || (UI.qs('next') ? 'signin' : 'signup');
  let role = UI.qs('role') || 'tutor';

  function go(res) {
    location.href = next ? '/' + next : res.home;
  }

  function rolesHTML() {
    return `<div class="roles">${Object.keys(Auth.ROLES).map(k => {
      const r = Auth.ROLES[k];
      const cls = !r.enabled ? 'role off' : (k === role ? 'role on' : 'role');
      return `<div class="${cls}" data-role="${k}" ${r.enabled ? '' : 'title="пока недоступно"'}>
        <b>${r.label}</b><span>${r.enabled ? r.hint : 'скоро'}</span></div>`;
    }).join('')}</div>`;
  }

  function render() {
    const signup = mode === 'signup';
    document.getElementById('box').innerHTML = `
      <h1>Token</h1>
      <div class="lead">Подготовка к экзамену с репетитором</div>

      <div class="tabs">
        <button data-mode="signin" class="${signup ? '' : 'on'}">Вход</button>
        <button data-mode="signup" class="${signup ? 'on' : ''}">Регистрация</button>
      </div>

      <section class="card">
        ${signup ? `
          <div class="hint csp-u-046">Кем вы будете пользоваться Token?</div>
          ${rolesHTML()}
          <div class="fld"><label>Имя и фамилия</label>
            <input id="f-name" placeholder="Дмитрий Стужин" autocomplete="name"></div>
          <div class="fld"><label>Email</label>
            <input id="f-email" type="email" placeholder="you@mail.ru" autocomplete="email"></div>
          <div class="fld"><label>Пароль</label>
            <input id="f-pass" type="password" minlength="10" placeholder="минимум 10 символов" autocomplete="new-password"></div>
          <div id="role-extra"></div>
          <button class="btn csp-u-072" id="do-signup">
            Создать аккаунт</button>
        ` : `
          <div class="fld"><label>Email</label>
            <input id="f-email" type="email" placeholder="you@mail.ru" autocomplete="email"></div>
          <div class="fld"><label>Пароль</label>
            <input id="f-pass" type="password" autocomplete="current-password"></div>
          <button class="btn csp-u-072" id="do-signin">
            Войти</button>
        `}
        <div id="out"></div>
      </section>


      <div class="note n-grey csp-u-055">
        Аккаунт создаётся на сервере: пароль солится и хешируется scrypt,
        сессия живёт в httpOnly-куке — из JavaScript её не прочитать.
      </div>`;

    document.querySelectorAll('[data-mode]').forEach(b =>
      b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));

    document.querySelectorAll('[data-role]').forEach(el =>
      el.addEventListener('click', () => {
        const k = el.dataset.role;
        if (!Auth.ROLES[k].enabled) {
          document.getElementById('out').innerHTML =
            `<div class="verdict v-wait">Роль «${Auth.ROLES[k].label}» пока не реализована —
             кабинет родителя появится позже.</div>`;
          return;
        }
        role = k; render();
      }));

    if (signup) renderExtra();

    const su = document.getElementById('do-signup');
    if (su) su.addEventListener('click', doSignup);
    const si = document.getElementById('do-signin');
    if (si) si.addEventListener('click', doSignin);

    const box = document.getElementById('box');
    box.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') (signup ? doSignup() : doSignin()); }));
  }

  function renderExtra() {
    const slot = document.getElementById('role-extra');
    if (!slot) return;
    if (role === 'tutor') {
      const subs = Core.db.subjects.map(s =>
        `<label class="csp-u-017">
           <input type="checkbox" class="f-subj csp-u-076" value="${s.id}" ${s.id === 'inf' ? 'checked' : ''}
                 > ${UI.esc(s.name)}</label>`).join('');
      slot.innerHTML = `
        <div class="fld"><label>Предметы, которые вы ведёте</label>
          <div class="csp-u-066">${subs}</div></div>
        <div class="row2">
          <div class="fld"><label>Опыт, лет</label><input id="f-exp" type="number" min="0" value="3"></div>
          <div class="fld"><label>Ставка, ₽/занятие</label><input id="f-rate" type="number" min="0" value="3000"></div>
        </div>`;
    } else if (role === 'student') {
      slot.innerHTML = `<div class="row2">
        <div class="fld"><label>Класс</label><input id="f-grade" type="number" min="5" max="11" value="11"></div>
        <div class="fld"><label>Школа</label><input id="f-school" placeholder="необязательно"></div>
      </div>`;
    } else {
      slot.innerHTML = '';
    }
  }

  async function doSignup() {
    const btn = document.getElementById('do-signup');
    const data = {
      role,
      name: (document.getElementById('f-name') || {}).value,
      email: (document.getElementById('f-email') || {}).value,
      password: (document.getElementById('f-pass') || {}).value,
      grade: (document.getElementById('f-grade') || {}).value,
      school: (document.getElementById('f-school') || {}).value,
      yearsExp: (document.getElementById('f-exp') || {}).value,
      rate: (document.getElementById('f-rate') || {}).value,
      subjects: [...document.querySelectorAll('.f-subj:checked')].map(x => x.value),
    };
    if (btn) btn.disabled = true;
    try { go(await Api.register(data)); }
    catch (e) {
      if (btn) btn.disabled = false;
      document.getElementById('out').innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  }

  async function doSignin() {
    const btn = document.getElementById('do-signin');
    if (btn) btn.disabled = true;
    try {
      go(await Api.login(
        (document.getElementById('f-email') || {}).value,
        (document.getElementById('f-pass') || {}).value));
    } catch (e) {
      if (btn) btn.disabled = false;
      document.getElementById('out').innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  }

  render();
})();
