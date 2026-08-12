/* Блок приглашений, встроенный в страницу учеников репетитора. */
window.InvitationPanel = (function () {
  function create(session) {
    const C = Core;
    const tutorId = session.tutorId;
    const tutor = C.tutorProfile(tutorId);
    const groups = C.groupsOfTutor(tutorId);
    const invites = C.invitesOfTutor(tutorId)
      .slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const active = invites.filter(invite => C.inviteState(invite).ok);

    const kinds = {
      enrollment: { label:'индивидуально', cls:'b-blue' },
      group: { label:'в группу', cls:'b-violet' },
      guardian: { label:'родителю', cls:'b-amber' },
    };

    function howHTML() {
      return `<section class="card">
        <div class="head"><div><h2>Как ученик попадает к вам</h2>
          <div class="hint">Привязку создаёт сам ученик — вручную никого заводить не нужно</div></div></div>
        <div class="steps">
          <div class="step"><span class="badge b-blue">1</span>
            <span><b>Выпустите ссылку</b><span class="muted small">форма ниже: предмет или группа, лимит переходов</span></span></div>
          <div class="step"><span class="badge b-blue">2</span>
            <span><b>Отправьте ученику</b><span class="muted small">он увидит вас, предмет и что появится в его кабинете</span></span></div>
          <div class="step"><span class="badge b-blue">3</span>
            <span><b>Он нажимает «Присоединиться»</b><span class="muted small">ученик появится в списке выше</span></span></div>
        </div>
      </section>`;
    }

    function formHTML() {
      const dropdown = (id, options, disabled) => {
        const first = options[0] || ['', 'Нет вариантов'];
        return `<div class="filter-dropdown invitation-dropdown${disabled ? ' disabled' : ''}" data-dropdown="${UI.attr(id)}">
          <input type="hidden" id="${UI.attr(id)}" value="${UI.attr(first[0])}">
          <button type="button" class="filter-dropdown-trigger" aria-expanded="false" ${disabled ? 'disabled' : ''}>
            <span>${UI.esc(first[1])}</span><i></i>
          </button>
          <div class="filter-dropdown-menu">${options.map(([value, label], index) =>
            `<button type="button" data-value="${UI.attr(value)}" class="${index === 0 ? 'selected' : ''}">
              ${UI.esc(label)}<span>✓</span></button>`).join('')}</div>
        </div>`;
      };
      const typeOptions = [['enrollment', 'Индивидуальные занятия']];
      if (groups.length) typeOptions.push(['group', 'Вступление в группу']);
      const subjectOptions = (tutor.subjects || []).map(id =>
        [id, (C.subject(id) || {}).name || id]);
      const groupOptions = groups.map(group => [group.id, group.title]);
      return `<section class="card">
        <div class="head"><div><h2>Новая ссылка</h2>
          <div class="hint">Код латиницей — его удобно продиктовать голосом</div></div></div>
        <div class="form-row">
          <label class="fld"><span>Тип</span>${dropdown('f-kind', typeOptions)}</label>
          <label class="fld" id="w-subj"><span>Предмет</span>${dropdown('f-subj', subjectOptions, !subjectOptions.length)}</label>
          <label class="fld" id="w-grp" hidden><span>Группа</span>${dropdown('f-grp', groupOptions, !groupOptions.length)}</label>
          <label class="fld csp-u-061"><span>Лимит переходов</span>
            <input id="f-max" type="number" min="1" value="5"></label>
          <button class="btn" id="f-make">Создать ссылку</button>
        </div>
        <div id="f-out"></div>
      </section>`;
    }

    function listHTML() {
      if (!invites.length) return `<section class="card">
        <div class="head"><h2>Выпущенные ссылки</h2></div>
        ${UI.empty('Ссылок пока нет', 'Создайте первую — форма выше.')}
      </section>`;

      const rows = invites.map(invite => {
        const state = C.inviteState(invite);
        const target = C.inviteTarget(invite);
        const left = invite.maxUses == null ? '∞' : Math.max(0, invite.maxUses - invite.usedCount);
        const kind = kinds[invite.kind] || kinds.enrollment;
        return `<tr>
          <td><code class="code">${UI.esc(invite.code)}</code></td>
          <td><span class="badge ${kind.cls}">${kind.label}</span></td>
          <td class="muted small">${target.group ? UI.esc(target.group.title)
            : target.subject ? UI.esc(target.subject.name) : '—'}</td>
          <td class="num">${invite.usedCount}</td><td class="num">${left}</td>
          <td class="muted small">${invite.expiresAt ? C.fmtDate(invite.expiresAt) : 'бессрочно'}</td>
          <td>${state.ok ? '<span class="badge b-green">активна</span>'
            : `<span class="badge b-grey">${UI.esc(state.label)}</span>`}</td>
          <td class="num csp-u-070">
            <button class="btn sm ghost copy" data-code="${UI.attr(invite.code)}">Копировать</button>
            <a class="btn sm grey" href="/invite.html?code=${encodeURIComponent(invite.code)}">Открыть</a>
            ${state.ok ? `<button class="btn sm grey revoke" data-id="${UI.attr(invite.id)}">Отозвать</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      return `<section class="card">
        <div class="head"><div><h2>Выпущенные ссылки</h2>
          <div class="hint">${active.length} ${C.plural(active.length,'активная','активные','активных')}
            из ${invites.length}</div></div></div>
        <table><thead><tr><th>Код</th><th>Тип</th><th>Куда</th><th class="num">Переходов</th>
          <th class="num">Осталось</th><th>Действует до</th><th>Статус</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="note n-grey csp-u-054">
          Принятие ссылки создаёт привязку <code>Enrollment</code> или участие
          <code>GroupMember</code>. Отозванная ссылка перестаёт работать сразу,
          но уже присоединившиеся ученики остаются.
        </div>
      </section>`;
    }

    function html() {
      return `<section class="student-invitations" id="invitations">
        <div class="section-heading"><div><h2>Приглашения</h2>
          <div class="muted">${active.length} ${C.plural(active.length,'действующая ссылка','действующие ссылки','действующих ссылок')}</div>
        </div></div>
        <div class="stack">${howHTML()}${formHTML()}${listHTML()}</div>
      </section>`;
    }

    function bind() {
      const kind = document.getElementById('f-kind');
      if (!kind) return;
      const updateTarget = () => {
        document.getElementById('w-grp').hidden = kind.value !== 'group';
        document.getElementById('w-subj').hidden = kind.value === 'group';
      };

      document.querySelectorAll('.invitation-dropdown').forEach(box => {
        const trigger = box.querySelector('.filter-dropdown-trigger');
        const input = box.querySelector('input');
        trigger.addEventListener('click', () => {
          const opening = !box.classList.contains('open');
          document.querySelectorAll('.invitation-dropdown.open').forEach(other => {
            other.classList.remove('open');
            other.querySelector('.filter-dropdown-trigger').setAttribute('aria-expanded', 'false');
          });
          box.classList.toggle('open', opening);
          trigger.setAttribute('aria-expanded', String(opening));
        });
        box.querySelectorAll('.filter-dropdown-menu button').forEach(option =>
          option.addEventListener('click', () => {
            input.value = option.dataset.value;
            trigger.querySelector('span').textContent = option.childNodes[0].textContent.trim();
            box.querySelectorAll('.filter-dropdown-menu button').forEach(item =>
              item.classList.toggle('selected', item === option));
            box.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            if (input === kind) updateTarget();
          }));
      });
      document.addEventListener('click', event => {
        if (!event.target.closest('.invitation-dropdown')) {
          document.querySelectorAll('.invitation-dropdown.open').forEach(box => {
            box.classList.remove('open');
            box.querySelector('.filter-dropdown-trigger').setAttribute('aria-expanded', 'false');
          });
        }
      });
      updateTarget();

      document.getElementById('f-make').addEventListener('click', async () => {
        const button = document.getElementById('f-make');
        const output = document.getElementById('f-out');
        button.disabled = true;
        try {
          const data = {
            kind: kind.value,
            maxUses: +document.getElementById('f-max').value || null,
            note: kind.value === 'group' ? 'Набор в группу' : 'Индивидуальные занятия',
          };
          if (kind.value === 'group') {
            data.groupId = document.getElementById('f-grp').value;
            if (!data.groupId) throw new Error('Сначала создайте группу');
          } else {
            data.subjectId = document.getElementById('f-subj').value;
            if (!data.subjectId) throw new Error('Выберите предмет');
          }
          const result = await Api.createInvite(data);
          const url = C.inviteUrl(result.invite.code);
          output.innerHTML = `<div class="verdict v-ok csp-u-054">Ссылка создана — код <b>${UI.esc(result.invite.code)}</b></div>
            <div class="editor csp-u-052"><div class="ehead"><span>отправьте ученику</span><span>переходов: 0</span></div>
              <pre class="csp-u-064">${UI.esc(url)}</pre></div>
            <div class="csp-u-023"><button class="btn sm" id="f-copy">Скопировать</button>
              <a class="btn sm ghost" href="/invite.html?code=${encodeURIComponent(result.invite.code)}">Открыть</a>
              <button class="btn sm grey" id="f-refresh">Обновить список</button></div>`;
          document.getElementById('f-copy').addEventListener('click', event => UI.copy(url, event.target));
          document.getElementById('f-refresh').addEventListener('click', () => location.reload());
        } catch (error) {
          output.innerHTML = `<div class="verdict v-no csp-u-054">${UI.esc(error.message)}</div>`;
        }
        button.disabled = false;
      });

      document.querySelectorAll('.copy').forEach(button =>
        button.addEventListener('click', () => UI.copy(C.inviteUrl(button.dataset.code), button)));
      document.querySelectorAll('.revoke').forEach(button =>
        button.addEventListener('click', async () => {
          if (!confirm('Отозвать ссылку? Присоединиться по ней больше нельзя.')) return;
          try { await Api.revokeInvite(button.dataset.id); location.reload(); }
          catch (error) { alert(error.message); }
        }));
    }

    return { html, bind };
  }

  return { create };
})();
