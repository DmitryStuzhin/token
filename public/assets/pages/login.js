(function () {
  const next = UI.qs('next');
  const already = Auth.session();
  if (already && !UI.qs('force')) { location.href = next ? '/' + next : already.home; return; }

  let mode = UI.qs('mode') || (UI.qs('next') ? 'signin' : 'signup');
  let role = UI.qs('role') || 'tutor';
  let challenge = null;
  let pendingEmail = '';
  let emailHint = '';

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
    const forgot = mode === 'forgot';
    const reset = mode === 'reset';
    const code = mode === 'code';
    const confirm = mode === 'confirm';
    const codeStep = code || confirm;
    document.getElementById('box').innerHTML = `
      <h1>Token</h1>
      <div class="lead">Подготовка к экзамену с репетитором</div>

      <div class="tabs ${forgot || reset || codeStep ? 'csp-u-050' : ''}">
        <button data-mode="signin" class="${signup ? '' : 'on'}">Вход</button>
        <button data-mode="signup" class="${signup ? 'on' : ''}">Регистрация</button>
      </div>

      <section class="card">
        ${codeStep ? `
          <h2>${code ? 'Код для входа' : 'Подтвердите email'}</h2>
          <p class="hint">Отправили код на ${UI.esc(emailHint || pendingEmail)}.
            ${code ? 'Код действует 10 минут.' : 'В письме есть и код, и ссылка — подойдёт любое.'}</p>
          <div class="fld"><label>Код из письма</label>
            <input id="f-code" inputmode="latin" autocomplete="one-time-code"
              placeholder="K7M-2PQ-9XZ" maxlength="11" spellcheck="false"></div>
          <button class="btn csp-u-072" id="do-code">Продолжить</button>
          <button class="text-action" id="do-resend-code">Отправить код ещё раз</button>
          <button class="text-action" data-mode="signin">Вернуться ко входу</button>
        ` : reset ? `
          <h2>Новый пароль</h2>
          <p class="hint">Ссылка одноразовая. После смены пароля все старые сессии завершатся.</p>
          <div class="fld"><label>Новый пароль</label>
            <input id="f-pass" type="password" minlength="10" autocomplete="new-password"></div>
          <button class="btn csp-u-072" id="do-reset">Сохранить пароль</button>
        ` : forgot ? `
          <h2>Восстановление доступа</h2>
          <p class="hint">Отправим одноразовую ссылку, если аккаунт существует.</p>
          <div class="fld"><label>Email</label>
            <input id="f-email" type="email" autocomplete="email"></div>
          <button class="btn csp-u-072" id="do-forgot">Отправить ссылку</button>
          <button class="text-action" data-mode="signin">Вернуться ко входу</button>
        ` : signup ? `
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
          <button class="text-action" data-mode="forgot">Забыли пароль?</button>
        `}
        <div id="out"></div>
      </section>


      <div class="note n-grey csp-u-055">
        Пароль защищён Argon2id, вход подтверждается одноразовым кодом из письма,
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
    document.getElementById('do-forgot')?.addEventListener('click', doForgot);
    document.getElementById('do-reset')?.addEventListener('click', doReset);
    document.getElementById('do-code')?.addEventListener('click', doCode);
    document.getElementById('do-resend-code')?.addEventListener('click', doResendCode);

    const codeInput = document.getElementById('f-code');
    if (codeInput) {
      // Код диктуют и переписывают руками, поэтому принимаем что угодно и сами
      // приводим к виду из письма: заглавные буквы и дефисы через три символа.
      codeInput.addEventListener('input', () => {
        const flat = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
        codeInput.value = (flat.match(/.{1,3}/g) || []).join('-');
      });
      codeInput.focus();
    }

    const box = document.getElementById('box');
    box.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        if (codeStep) doCode();
        else if (reset) doReset(); else if (forgot) doForgot();
        else if (signup) doSignup(); else doSignin();
      }));
    const verified = UI.qs('verified');
    if (verified === '1') document.getElementById('out').innerHTML = '<div class="verdict v-ok">Email подтверждён. Теперь войдите.</div>';
    if (verified === '0') document.getElementById('out').innerHTML = '<div class="verdict v-no">Ссылка недействительна или истекла.</div>';
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
    try {
      const result = await Api.register(data);
      pendingEmail = result.email;
      emailHint = result.email;
      mode = 'confirm';
      render();
      if (result.emailSent === false) {
        document.getElementById('out').innerHTML =
          '<div class="verdict v-wait">Аккаунт создан, но письмо не ушло. Нажмите «Отправить код ещё раз».</div>';
      }
    }
    catch (e) {
      if (btn) btn.disabled = false;
      document.getElementById('out').innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  }

  async function doSignin() {
    const btn = document.getElementById('do-signin');
    const email = (document.getElementById('f-email') || {}).value;
    if (btn) btn.disabled = true;
    try {
      const result = await Api.login(email, (document.getElementById('f-pass') || {}).value);
      // Доверенное устройство пускает сразу, новое — уводит на ввод кода.
      if (!result.codeRequired) return go(result);
      challenge = result.challenge;
      pendingEmail = email;
      emailHint = result.emailHint || email;
      mode = 'code';
      render();
      if (result.emailSent === false) {
        document.getElementById('out').innerHTML =
          '<div class="verdict v-wait">Письмо не ушло. Нажмите «Отправить код ещё раз».</div>';
      }
    } catch (e) {
      if (btn) btn.disabled = false;
      document.getElementById('out').innerHTML = e.code === 'EMAIL_UNVERIFIED'
        ? `<div class="verdict v-wait">${UI.esc(e.message)} <button id="resend-email">Отправить письмо ещё раз</button></div>`
        : `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
      document.getElementById('resend-email')?.addEventListener('click', async () => {
        await Api.resendVerification(email);
        pendingEmail = email;
        emailHint = email;
        mode = 'confirm';
        render();
      });
    }
  }

  async function doCode() {
    const button = document.getElementById('do-code');
    const value = (document.getElementById('f-code') || {}).value;
    const out = document.getElementById('out');
    button.disabled = true;
    try {
      if (mode === 'code') {
        go(await Api.loginCode(challenge, value));
      } else {
        await Api.verifyEmailCode(pendingEmail, value);
        mode = 'signin';
        render();
        document.getElementById('out').innerHTML =
          '<div class="verdict v-ok">Email подтверждён. Теперь войдите.</div>';
      }
    } catch (e) {
      button.disabled = false;
      out.innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}${
        e.attemptsLeft ? `. Осталось попыток: ${e.attemptsLeft}` : ''}.</div>`;
      const input = document.getElementById('f-code');
      if (input) { input.value = ''; input.focus(); }
    }
  }

  async function doResendCode() {
    const out = document.getElementById('out');
    try {
      if (mode === 'code') {
        const result = await Api.resendLoginCode(challenge);
        challenge = result.challenge;
      } else {
        await Api.resendVerification(pendingEmail);
      }
      out.innerHTML = '<div class="verdict v-ok">Новый код отправлен. Прежний больше не действует.</div>';
    } catch (e) {
      out.innerHTML = `<div class="verdict v-no">${UI.esc(e.message)}</div>`;
    }
  }

  async function doForgot() {
    const button = document.getElementById('do-forgot');
    button.disabled = true;
    try {
      await Api.forgotPassword((document.getElementById('f-email') || {}).value);
      document.getElementById('out').innerHTML = '<div class="verdict v-ok">Если аккаунт существует, письмо уже отправлено.</div>';
    } catch (error) {
      button.disabled = false;
      document.getElementById('out').innerHTML = `<div class="verdict v-no">${UI.esc(error.message)}</div>`;
    }
  }

  async function doReset() {
    const button = document.getElementById('do-reset');
    button.disabled = true;
    try {
      await Api.resetPassword(UI.qs('token'), (document.getElementById('f-pass') || {}).value);
      mode = 'signin';
      history.replaceState(null, '', '/login.html?mode=signin&reset=1');
      render();
      document.getElementById('out').innerHTML = '<div class="verdict v-ok">Пароль изменён. Войдите снова.</div>';
    } catch (error) {
      button.disabled = false;
      document.getElementById('out').innerHTML = `<div class="verdict v-no">${UI.esc(error.message)}</div>`;
    }
  }

  render();
})();
