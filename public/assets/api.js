/* ═══════════════════════════════════════════════════════════════════
   КЛИЕНТ API

   Единственный способ что-либо изменить. Сессия едет в httpOnly-куке,
   поэтому здесь нет ни токенов, ни паролей в localStorage.
   ═══════════════════════════════════════════════════════════════════ */
window.Api = (function () {
  async function call(method, path, body) {
    let res;
    try {
      const needsKey = method === 'POST' && [
        '/invites', '/invites/accept', '/groups', '/lessons', '/assignments', '/tasks/import',
      ].includes(path);
      const headers = body ? { 'Content-Type': 'application/json' } : {};
      if (needsKey) headers['Idempotency-Key'] = crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
      res = await fetch('/api/v1' + path, {
        method,
        credentials: 'same-origin',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Сервер недоступен — проверьте, что он запущен');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && (data.detail || data.error)) || 'Ошибка ' + res.status);
      err.status = res.status;
      err.details = data && data.errors;
      throw err;
    }
    return data;
  }

  const get = p => call('GET', p);
  const post = (p, b) => call('POST', p, b);
  const del = p => call('DELETE', p);

  return {
    call, get, post, del,

    /* вход */
    register: data => post('/auth/register', data),
    login: (email, password) => post('/auth/login', { email, password }),
    logout: () => post('/auth/logout'),
    me: () => get('/auth/me'),
    roles: () => get('/auth/roles'),

    /* приглашения */
    createInvite: data => post('/invites', data),
    revokeInvite: id => post('/invites/' + encodeURIComponent(id) + '/revoke'),
    lookupInvite: code => get('/invites/' + encodeURIComponent(code)),
    acceptInvite: code => post('/invites/accept', { code }),

    /* группы и занятия */
    createGroup: data => post('/groups', data),
    createLesson: data => post('/lessons', data),
    addLink: (lessonId, link) => post('/lessons/' + lessonId + '/links', link),
    removeLink: (lessonId, i) => del('/lessons/' + lessonId + '/links/' + i),
    attachTask: (lessonId, taskId) => post('/lessons/' + lessonId + '/tasks', { taskId }),
    detachTask: (lessonId, taskId) => del('/lessons/' + lessonId + '/tasks/' + encodeURIComponent(taskId)),
    setLessonStatus: (lessonId, status) => post('/lessons/' + lessonId + '/status', { status }),

    /* задания и работы */
    createAssignment: data => post('/assignments', data),
    startPractice: taskId => post('/practice/' + encodeURIComponent(taskId)),
    progress: (id, code, activeSeconds) => post('/attempts/' + id + '/progress', { code, activeSeconds }),
    progressOnExit: (id, code, activeSeconds) => fetch('/api/v1/attempts/' + encodeURIComponent(id) + '/progress', {
      method:'POST', credentials:'same-origin', keepalive:true,
      headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ code, activeSeconds }),
    }),
    coach: (id, code) => post('/attempts/' + id + '/coach', { code }),
    answer: (id, answer, activeSeconds) => post('/attempts/' + id + '/answer', { answer, activeSeconds }),
    submit: (id, code, activeSeconds) => post('/attempts/' + id + '/submit', { code, activeSeconds }),
    review: (id, score, comment) => post('/attempts/' + id + '/review', { score, comment }),

    /* прочее */
    importTasks: tasks => post('/tasks/import', { tasks }),
    setPref: (channel, enabled) => post('/prefs', { channel, enabled }),
  };
})();
