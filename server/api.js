/* ═══════════════════════════════════════════════════════════════════
   API

   Всё, что раньше делал браузер, делает сервер: создаёт занятия,
   прикрепляет задания, принимает приглашения, проверяет ответы.
   Права проверяются на каждом маршруте — клиенту не доверяем.

   Эталонные ответы задач наружу не отдаются: сверка только здесь.
   ═══════════════════════════════════════════════════════════════════ */
const express = require('express');
const { db, all, one, snapshot, fullState, taskWithAnswer, publicTasks } = require('./db.js');
const A = require('./auth.js');
const { createCore } = require('../shared/core.js');
const Domain = require('../shared/domain.js');

const router = express.Router();
const now = () => new Date().toISOString();
const uid = A.uid;

/* ядро над полным состоянием — только для серверных проверок */
function fullCore() {
  return createCore(fullState());
}

/* ── вспомогательное: доступ репетитора к сущностям ──────────────── */
function tutorOwnsLesson(tutorId, lessonId) {
  const l = one('SELECT * FROM lessons WHERE id = ?', lessonId);
  return l && l.tutor_id === tutorId ? l : null;
}
function studentsOfLessonRow(l) {
  if (l.group_id) return all('SELECT student_id FROM group_members WHERE group_id = ? AND status = ?', l.group_id, 'active').map(r => r.student_id);
  const e = one('SELECT * FROM enrollments WHERE id = ?', l.enrollment_id);
  return e ? [e.student_id] : [];
}
function ensureAttempt(studentId, taskId, scope) {
  const t = one('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t) return null;
  const found = one(`SELECT * FROM attempts WHERE student_id = ? AND task_id = ?
                     AND IFNULL(assignment_id,'') = IFNULL(?, '') AND IFNULL(lesson_id,'') = IFNULL(?, '')`,
    studentId, taskId, scope.assignmentId || null, scope.lessonId || null);
  if (found) return found;
  const id = uid('at');
  db.prepare(`INSERT INTO attempts (id,task_id,student_id,subject_id,context,lesson_id,assignment_id,group_id,
              code,answer,tries,is_correct,first_try_correct,active_seconds,status)
              VALUES (?,?,?,?,?,?,?,?,'','',0,NULL,NULL,0,'issued')`)
    .run(id, taskId, studentId, t.subject_id, scope.lessonId ? 'lesson' : 'homework',
         scope.lessonId || null, scope.assignmentId || null, scope.groupId || null);
  return one('SELECT * FROM attempts WHERE id = ?', id);
}

/* ── состояние ───────────────────────────────────────────────────── */
router.get('/state', (req, res) => res.json(snapshot(req.user)));

/* Тот же снимок, но как исполняемый скрипт: страницы подключают его
   тегом <script> и стартуют синхронно, без мигания пустым экраном. */
router.get('/state.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send('window.__STATE__ = ' + JSON.stringify(snapshot(req.user)) + ';');
});

/* ── аутентификация ──────────────────────────────────────────────── */
router.get('/auth/roles', (req, res) => res.json(A.ROLES));

router.post('/auth/register', (req, res) => {
  const r = A.register(req.body || {});
  if (r.error) return res.status(400).json({ error:r.error });
  const s = A.createSession(r.user.id, req.headers['user-agent']);
  A.setCookie(res, s.token, s.expires);
  res.json({ ok:true, role:r.user.role, home:A.ROLES[r.user.role].home });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const r = A.login(email, password);
  if (r.error) return res.status(401).json({ error:r.error });
  const s = A.createSession(r.user.id, req.headers['user-agent']);
  A.setCookie(res, s.token, s.expires);
  res.json({ ok:true, role:r.user.role, home:A.ROLES[r.user.role].home });
});

router.post('/auth/logout', (req, res) => {
  A.destroySession(req.sessionToken);
  A.clearCookie(res);
  res.json({ ok:true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user:null });
  res.json({ user:{ id:req.user.id, role:req.user.role, name:req.user.name, email:req.user.email },
             home:A.ROLES[req.user.role].home });
});

/* ── банк задач ──────────────────────────────────────────────────── */
router.get('/tasks', A.requireUser, (req, res) => {
  const list = publicTasks().filter(t => !req.query.subject || t.subjectId === req.query.subject);
  res.json(list);
});

router.post('/tasks/import', A.requireRole('tutor'), (req, res) => {
  const arr = req.body && req.body.tasks;
  if (!Array.isArray(arr)) return res.status(400).json({ error:'Ожидался массив задач' });
  const C = fullCore();
  const errors = [];
  const seen = new Set();
  arr.forEach((t, i) => {
    ['id','subjectId','number','title','statement'].forEach(f => {
      if (t[f] == null || t[f] === '') errors.push(`[${i}] нет поля ${f}`);
    });
    if (t.subjectId && !C.subject(t.subjectId)) errors.push(`[${i}] неизвестный предмет «${t.subjectId}»`);
    else if (t.number != null && !C.partOf(t.subjectId, +t.number))
      errors.push(`[${i}] в предмете нет задания №${t.number}`);
    if (t.id && one('SELECT id FROM tasks WHERE id = ?', String(t.id))) errors.push(`[${i}] id «${t.id}» уже есть`);
    if (t.id && seen.has(t.id)) errors.push(`[${i}] id «${t.id}» повторяется в файле`);
    if (t.id) seen.add(t.id);
    if (t.compare && !['exact','ci','set','numeric'].includes(t.compare))
      errors.push(`[${i}] compare должен быть exact | ci | set | numeric`);
  });
  if (errors.length) return res.status(400).json({ error:'Импорт отклонён', errors });

  const ins = db.prepare(`INSERT INTO tasks
    (id,subject_id,number,topic_id,title,statement,answer,answer_type,compare,tolerance,auto_check,difficulty,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(rows => rows.forEach(t => {
    const part = C.partOf(t.subjectId, +t.number) || {};
    const answer = t.answer == null ? '' : String(t.answer);
    ins.run(String(t.id), t.subjectId, +t.number, t.topicId || part.topicId || null,
      String(t.title), String(t.statement), answer, t.answerType || 'string',
      t.compare || 'exact', t.tolerance || 0,
      (t.autoCheck != null ? !!t.autoCheck : !!answer.trim()) ? 1 : 0,
      t.difficulty || 2, t.source || 'import');
  }))(arr);
  res.json({ ok:true, imported:arr.length });
});

/* ── приглашения ─────────────────────────────────────────────────── */
router.post('/invites', A.requireRole('tutor'), (req, res) => {
  const { kind, subjectId, groupId, maxUses, expiresAt, note } = req.body || {};
  if (!['enrollment','group'].includes(kind)) return res.status(400).json({ error:'Неизвестный тип приглашения' });
  let subj = subjectId;
  if (kind === 'group') {
    const g = one('SELECT * FROM groups WHERE id = ?', groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subj = g.subject_id;
  }
  if (!one('SELECT id FROM subjects WHERE id = ?', subj)) return res.status(400).json({ error:'Неизвестный предмет' });

  /* код только из латиницы и цифр, без похожих друг на друга символов:
     его диктуют голосом и вставляют в адресную строку */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick4 = () => Array.from({ length:4 }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  let code = pick4() + '-' + pick4();
  while (one('SELECT id FROM invites WHERE code = ?', code)) code = pick4() + '-' + pick4();
  const id = uid('inv');
  db.prepare(`INSERT INTO invites (id,code,kind,tutor_id,subject_id,group_id,student_id,
              created_by,created_at,expires_at,max_uses,used_count,status,note)
              VALUES (?,?,?,?,?,?,NULL,?,?,?,?,0,'active',?)`)
    .run(id, code, kind, req.tutorId, subj, kind === 'group' ? groupId : null,
         req.user.id, now(), expiresAt || null, maxUses == null ? null : +maxUses, String(note || ''));
  res.json({ ok:true, invite: require('./db.js').rows.rowInvite(one('SELECT * FROM invites WHERE id = ?', id)) });
});

router.post('/invites/:id/revoke', A.requireRole('tutor'), (req, res) => {
  const inv = one('SELECT * FROM invites WHERE id = ?', req.params.id);
  if (!inv || inv.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваше приглашение' });
  db.prepare("UPDATE invites SET status = 'revoked' WHERE id = ?").run(inv.id);
  res.json({ ok:true });
});

/* публичный просмотр приглашения по коду — чтобы показать, куда зовут */
router.get('/invites/:code', A.requireUser, (req, res) => {
  const C = fullCore();
  const inv = C.inviteByCode(req.params.code);
  const state = C.inviteState(inv);
  if (!inv) return res.status(404).json({ error:state.label, state });
  res.json({ invite:inv, state, target:C.inviteTarget(inv),
             joined: req.studentId ? C.inviteAlreadyJoined(inv, req.studentId) : false });
});

router.post('/invites/accept', A.requireRole('student'), (req, res) => {
  const C = fullCore();
  const inv = C.inviteByCode((req.body || {}).code);
  const state = C.inviteState(inv);
  if (!state.ok) return res.status(400).json({ error:state.label });
  if (C.inviteAlreadyJoined(inv, req.studentId)) return res.status(400).json({ error:'Вы уже присоединены по этой ссылке' });
  if (inv.kind === 'guardian') return res.status(400).json({ error:'Ссылку для родителя принимает родитель' });

  db.transaction(() => {
    if (inv.kind === 'enrollment') {
      db.prepare(`INSERT INTO enrollments (id,student_id,tutor_id,subject_id,status,started_at,source,invite_id)
                  VALUES (?,?,?,?,'active',?, 'invite', ?)`)
        .run(uid('e'), req.studentId, inv.tutorId, inv.subjectId, now().slice(0, 10), inv.id);
    } else {
      db.prepare(`INSERT INTO group_members (group_id,student_id,joined_at,status,source,invite_id)
                  VALUES (?,?,?, 'active','invite',?)`)
        .run(inv.groupId, req.studentId, now().slice(0, 10), inv.id);
      /* уже выданные групповые задания разворачиваем на новичка */
      all('SELECT * FROM assignments WHERE group_id = ?', inv.groupId).forEach(a => {
        JSON.parse(a.task_ids || '[]').forEach(taskId =>
          ensureAttempt(req.studentId, taskId, { assignmentId:a.id, groupId:inv.groupId }));
      });
    }
    const used = inv.usedCount + 1;
    db.prepare('UPDATE invites SET used_count = ?, status = ? WHERE id = ?')
      .run(used, (inv.maxUses != null && used >= inv.maxUses) ? 'used_up' : 'active', inv.id);
  })();

  res.json({ ok:true, target:C.inviteTarget(inv) });
});

/* ── группы ──────────────────────────────────────────────────────── */
router.post('/groups', A.requireRole('tutor'), (req, res) => {
  const { subjectId, title, level, schedule, capacity } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error:'Укажите название группы' });
  if (!one('SELECT id FROM subjects WHERE id = ?', subjectId)) return res.status(400).json({ error:'Неизвестный предмет' });
  const id = uid('gr');
  db.prepare(`INSERT INTO groups (id,tutor_id,subject_id,title,level,schedule,capacity,status,created_at)
              VALUES (?,?,?,?,?,?,?, 'recruiting', ?)`)
    .run(id, req.tutorId, subjectId, String(title).trim(), String(level || 'база'),
         String(schedule || ''), +capacity || 8, now().slice(0, 10));
  res.json({ ok:true, id });
});

/* ── занятия ─────────────────────────────────────────────────────── */
router.post('/lessons', A.requireRole('tutor'), (req, res) => {
  const { enrollmentId, groupId, startsAt, durationMin } = req.body || {};
  if (!startsAt || isNaN(new Date(startsAt).getTime())) return res.status(400).json({ error:'Неверная дата начала' });
  let subjectId = null;
  if (enrollmentId) {
    const e = one('SELECT * FROM enrollments WHERE id = ?', enrollmentId);
    if (!e || e.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваш ученик' });
    subjectId = e.subject_id;
  } else if (groupId) {
    const g = one('SELECT * FROM groups WHERE id = ?', groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subjectId = g.subject_id;
  } else return res.status(400).json({ error:'Укажите ученика или группу' });

  const id = uid('l');
  db.prepare(`INSERT INTO lessons (id,subject_id,tutor_id,enrollment_id,group_id,starts_at,duration_min,status,links,task_ids,note)
              VALUES (?,?,?,?,?,?,?, 'planned','[]','[]',NULL)`)
    .run(id, subjectId, req.tutorId, enrollmentId || null, groupId || null,
         new Date(startsAt).toISOString(), +durationMin || 60);
  res.json({ ok:true, id });
});

router.post('/lessons/:id/links', A.requireRole('tutor'), (req, res) => {
  const l = tutorOwnsLesson(req.tutorId, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ error:'Пустая ссылка' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error:'Ссылка должна начинаться с http:// или https://' });
  const type = ['call','board','material'].includes((req.body || {}).type) ? req.body.type : 'material';
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [, ''])[1].replace(/^www\./, '');
  const label = String((req.body || {}).label || '').trim() ||
    ({ call:'Созвон', board:'Доска', material:'Материал' }[type] + (host ? ' · ' + host : ''));

  const links = JSON.parse(l.links || '[]').concat({ type, label, url });
  db.prepare('UPDATE lessons SET links = ? WHERE id = ?').run(JSON.stringify(links), l.id);
  res.json({ ok:true, links });
});

router.delete('/lessons/:id/links/:index', A.requireRole('tutor'), (req, res) => {
  const l = tutorOwnsLesson(req.tutorId, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const links = JSON.parse(l.links || '[]');
  links.splice(+req.params.index, 1);
  db.prepare('UPDATE lessons SET links = ? WHERE id = ?').run(JSON.stringify(links), l.id);
  res.json({ ok:true, links });
});

router.post('/lessons/:id/tasks', A.requireRole('tutor'), (req, res) => {
  const l = tutorOwnsLesson(req.tutorId, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const taskId = String((req.body || {}).taskId || '');
  const t = one('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!t) return res.status(404).json({ error:'Задача не найдена' });
  if (t.subject_id !== l.subject_id) return res.status(400).json({ error:'Задача из другого предмета' });
  const ids = JSON.parse(l.task_ids || '[]');
  if (ids.includes(taskId)) return res.status(400).json({ error:'Задача уже прикреплена' });

  db.transaction(() => {
    db.prepare('UPDATE lessons SET task_ids = ? WHERE id = ?').run(JSON.stringify(ids.concat(taskId)), l.id);
    studentsOfLessonRow(l).forEach(sid => ensureAttempt(sid, taskId, { lessonId:l.id, groupId:l.group_id }));
  })();
  res.json({ ok:true });
});

router.delete('/lessons/:id/tasks/:taskId', A.requireRole('tutor'), (req, res) => {
  const l = tutorOwnsLesson(req.tutorId, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const ids = JSON.parse(l.task_ids || '[]').filter(x => x !== req.params.taskId);
  db.transaction(() => {
    db.prepare('UPDATE lessons SET task_ids = ? WHERE id = ?').run(JSON.stringify(ids), l.id);
    /* нетронутые попытки убираем, начатые оставляем — это уже работа ученика */
    db.prepare("DELETE FROM attempts WHERE lesson_id = ? AND task_id = ? AND status = 'issued'")
      .run(l.id, req.params.taskId);
  })();
  res.json({ ok:true });
});

router.post('/lessons/:id/status', A.requireRole('tutor'), (req, res) => {
  const l = tutorOwnsLesson(req.tutorId, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const status = (req.body || {}).status;
  if (!['planned','done','moved','missed'].includes(status)) return res.status(400).json({ error:'Неизвестный статус' });

  db.transaction(() => {
    db.prepare('UPDATE lessons SET status = ? WHERE id = ?').run(status, l.id);
    if (status === 'done') {
      studentsOfLessonRow(l).forEach(sid => {
        db.prepare(`INSERT INTO lesson_attendance (lesson_id,student_id,status) VALUES (?,?, 'present')
                    ON CONFLICT(lesson_id,student_id) DO UPDATE SET status = 'present'`).run(l.id, sid);
        const sub = one('SELECT * FROM subscriptions WHERE student_id = ?', sid);
        if (sub && sub.lessons_left > 0)
          db.prepare('UPDATE subscriptions SET lessons_left = lessons_left - 1 WHERE id = ?').run(sub.id);
      });
    }
  })();
  res.json({ ok:true });
});

/* ── домашние задания ────────────────────────────────────────────── */
router.post('/assignments', A.requireRole('tutor'), (req, res) => {
  const { enrollmentId, groupId, lessonId, title, dueAt, taskIds } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error:'Укажите название задания' });
  if (!Array.isArray(taskIds) || !taskIds.length) return res.status(400).json({ error:'Выберите хотя бы одну задачу' });

  let subjectId = null, students = [];
  if (enrollmentId) {
    const e = one('SELECT * FROM enrollments WHERE id = ?', enrollmentId);
    if (!e || e.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваш ученик' });
    subjectId = e.subject_id; students = [e.student_id];
  } else if (groupId) {
    const g = one('SELECT * FROM groups WHERE id = ?', groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subjectId = g.subject_id;
    students = all('SELECT student_id FROM group_members WHERE group_id = ? AND status = ?', groupId, 'active').map(r => r.student_id);
  } else return res.status(400).json({ error:'Укажите ученика или группу' });

  const id = uid('a');
  db.transaction(() => {
    db.prepare(`INSERT INTO assignments (id,subject_id,enrollment_id,group_id,lesson_id,title,due_at,task_ids)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, subjectId, enrollmentId || null, groupId || null, lessonId || null,
           String(title).trim(), dueAt ? new Date(dueAt).toISOString() : now(), JSON.stringify(taskIds));
    students.forEach(sid => taskIds.forEach(t => ensureAttempt(sid, t, { assignmentId:id, groupId:groupId || null })));
  })();
  res.json({ ok:true, id });
});

/* ── попытки ─────────────────────────────────────────────────────── */
function ownAttempt(req, res) {
  const a = one('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!a) { res.status(404).json({ error:'Попытка не найдена' }); return null; }
  if (a.student_id !== req.studentId) { res.status(403).json({ error:'Это чужая работа' }); return null; }
  return a;
}

/* черновик и время: приходит с heartbeat раз в 15 секунд */
router.post('/attempts/:id/progress', A.requireRole('student'), (req, res) => {
  const a = ownAttempt(req, res); if (!a) return;
  if (a.status === 'checked' || a.status === 'submitted') return res.status(400).json({ error:'Работа уже закрыта' });
  const { code, activeSeconds } = req.body || {};
  const secs = Math.max(a.active_seconds || 0, Math.min(+activeSeconds || 0, 6 * 3600));
  db.prepare(`UPDATE attempts SET code = ?, active_seconds = ?, status = ?, started_at = IFNULL(started_at, ?)
              WHERE id = ?`)
    .run(code == null ? a.code : String(code).slice(0, 20000), secs,
         a.status === 'issued' ? 'in_progress' : a.status, now(), a.id);
  req.app.locals.live.push(a.lesson_id, a.student_id);
  res.json({ ok:true, activeSeconds:secs });
});

/* проверка ответа — эталон сравнивается только здесь */
router.post('/attempts/:id/answer', A.requireRole('student'), (req, res) => {
  const a = ownAttempt(req, res); if (!a) return;
  if (a.status === 'checked' || a.status === 'submitted') return res.status(400).json({ error:'Работа уже закрыта' });
  const task = taskWithAnswer(a.task_id);
  if (!task) return res.status(404).json({ error:'Задача не найдена' });
  if (!task.autoCheck) return res.status(400).json({ error:'Это задание проверяет репетитор' });

  const value = String((req.body || {}).answer || '');
  if (!value.trim()) return res.status(400).json({ error:'Пустой ответ' });

  const C = fullCore();
  const correct = C.checkAnswer(task, value);
  const tries = (a.tries || 0) + 1;
  const secs = Math.max(a.active_seconds || 0, Math.min(+(req.body || {}).activeSeconds || 0, 6 * 3600));

  db.prepare(`UPDATE attempts SET answer = ?, tries = ?, is_correct = ?, first_try_correct = ?,
              active_seconds = ?, status = ?, started_at = IFNULL(started_at, ?), submitted_at = ?
              WHERE id = ?`)
    .run(value, tries, correct ? 1 : 0, (correct && tries === 1) ? 1 : 0, secs,
         correct ? 'checked' : (a.status === 'issued' ? 'in_progress' : a.status),
         now(), correct ? now() : a.submitted_at, a.id);

  req.app.locals.live.push(a.lesson_id, a.student_id);
  /* правильный ответ отдаём только после того, как задача закрыта */
  res.json({ ok:true, correct, tries, answer: correct ? null : undefined });
});

/* отправка на ручную проверку */
router.post('/attempts/:id/submit', A.requireRole('student'), (req, res) => {
  const a = ownAttempt(req, res); if (!a) return;
  if (a.status === 'submitted' || a.status === 'checked') return res.status(400).json({ error:'Работа уже отправлена' });
  const secs = Math.max(a.active_seconds || 0, Math.min(+(req.body || {}).activeSeconds || 0, 6 * 3600));
  db.prepare(`UPDATE attempts SET code = ?, active_seconds = ?, status = 'submitted',
              started_at = IFNULL(started_at, ?), submitted_at = ? WHERE id = ?`)
    .run(String((req.body || {}).code || a.code || '').slice(0, 20000), secs, now(), now(), a.id);
  req.app.locals.live.push(a.lesson_id, a.student_id);
  res.json({ ok:true });
});

/* проверка репетитором */
router.post('/attempts/:id/review', A.requireRole('tutor'), (req, res) => {
  const a = one('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error:'Работа не найдена' });
  const mine = one(`SELECT 1 x FROM enrollments WHERE tutor_id = ? AND student_id = ?
                    UNION SELECT 1 x FROM groups g JOIN group_members gm ON gm.group_id = g.id
                    WHERE g.tutor_id = ? AND gm.student_id = ?`,
    req.tutorId, a.student_id, req.tutorId, a.student_id);
  if (!mine) return res.status(403).json({ error:'Это не ваш ученик' });

  const score = Math.max(0, Math.min(10, +(req.body || {}).score || 0));
  db.prepare(`UPDATE attempts SET status = 'checked', is_correct = ?, review_score = ?,
              review_comment = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .run(score > 0 ? 1 : 0, score, String((req.body || {}).comment || '').slice(0, 2000),
         req.tutorId, now(), a.id);
  res.json({ ok:true });
});

/* ── уведомления ─────────────────────────────────────────────────── */
router.post('/prefs', A.requireUser, (req, res) => {
  const { channel, enabled } = req.body || {};
  if (!channel) return res.status(400).json({ error:'Не указан канал' });
  db.prepare(`INSERT INTO notification_prefs (user_id,channel,enabled,handle,minutes_before)
              VALUES (?,?,?,'',NULL)
              ON CONFLICT(user_id,channel) DO UPDATE SET enabled = excluded.enabled`)
    .run(req.user.id, String(channel), enabled ? 1 : 0);
  res.json({ ok:true });
});

module.exports = router;
