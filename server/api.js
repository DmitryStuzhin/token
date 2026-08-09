/* ═══════════════════════════════════════════════════════════════════
   API

   Всё, что раньше делал браузер, делает сервер: создаёт занятия,
   прикрепляет задания, принимает приглашения, проверяет ответы.
   Права проверяются на каждом маршруте — клиенту не доверяем.

   Эталонные ответы задач наружу не отдаются: сверка только здесь.
   ═══════════════════════════════════════════════════════════════════ */
const express = require('express');
const A = require('./auth.js');
const { createCore } = require('../shared/core.js');
const Domain = require('../shared/domain.js');
const { domainEvent } = require('../modules/shared/application/event-factory.ts');
const { transitionInvite } = require('../modules/relationships/domain/invite.ts');
const { transitionAssignment } = require('../modules/learning/domain/assignment.ts');
const { transitionAttempt, clampActiveSeconds } = require('../modules/learning/domain/attempt.ts');

const router = express.Router();
const now = () => new Date().toISOString();
const uid = A.uid;
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const repository = req => req.app.locals.repository;

function assertUpdated(result, entity, id) {
  if ((result.changes ?? result.rowCount) !== 1) {
    const error = new Error(`${entity} «${id}» уже изменён другим запросом`);
    error.code = 'CONFLICT';
    throw error;
  }
}

/* ядро над полным состоянием — только для серверных проверок */
async function fullCore(req) {
  return createCore(await repository(req).fullState());
}

/* ── вспомогательное: доступ репетитора к сущностям ──────────────── */
function tutorOwnsLesson(req, lessonId) {
  return repository(req).findOwnedLesson(req.tutorId, lessonId);
}
function studentsOfLessonRow(req, lesson) {
  return repository(req).studentsOfLesson(lesson);
}
function ensureAttempt(req, studentId, taskId, scope) {
  return repository(req).ensureAttempt(studentId, taskId, scope, () => uid('at'));
}

/* ── состояние ───────────────────────────────────────────────────── */
router.get('/state', asyncRoute(async (req, res) => res.json(await repository(req).snapshot(req.user))));

/* Тот же снимок, но как исполняемый скрипт: страницы подключают его
   тегом <script> и стартуют синхронно, без мигания пустым экраном. */
router.get('/state.js', asyncRoute(async (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send('window.__STATE__ = ' + JSON.stringify(await repository(req).snapshot(req.user)) + ';');
}));

/* ── аутентификация ──────────────────────────────────────────────── */
router.get('/auth/roles', (req, res) => res.json(A.ROLES));

router.post('/auth/register', asyncRoute(async (req, res) => {
  const r = await req.app.locals.auth.register(req.body || {});
  if (r.error) return res.status(400).json({ error:r.error });
  const s = await req.app.locals.auth.createSession(r.user.id, req.headers['user-agent']);
  A.setCookie(res, s.token, s.expires);
  await req.app.locals.services.events.publish(domainEvent({
    name:'UserRegistered', aggregateId:r.user.id,
    correlationId:req.id,
    payload:{ userId:r.user.id, role:r.user.role },
  }));
  res.json({ ok:true, role:r.user.role, home:A.ROLES[r.user.role].home });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const r = await req.app.locals.auth.login(email, password);
  if (r.error) return res.status(401).json({ error:r.error });
  const s = await req.app.locals.auth.createSession(r.user.id, req.headers['user-agent']);
  A.setCookie(res, s.token, s.expires);
  res.json({ ok:true, role:r.user.role, home:A.ROLES[r.user.role].home });
}));

router.post('/auth/logout', asyncRoute(async (req, res) => {
  await req.app.locals.auth.destroySession(req.sessionToken);
  A.clearCookie(res);
  res.json({ ok:true });
}));

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user:null });
  res.json({ user:{ id:req.user.id, role:req.user.role, name:req.user.name, email:req.user.email },
             home:A.ROLES[req.user.role].home });
});

/* ── банк задач ──────────────────────────────────────────────────── */
router.get('/tasks', A.requireUser, asyncRoute(async (req, res) => {
  const list = (await repository(req).publicTasks()).filter(t => !req.query.subject || t.subjectId === req.query.subject);
  res.json(list);
}));

router.post('/tasks/import', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const arr = req.body && req.body.tasks;
  if (!Array.isArray(arr)) return res.status(400).json({ error:'Ожидался массив задач' });
  const C = await fullCore(req);
  const errors = [];
  const seen = new Set();
  arr.forEach((t, i) => {
    ['id','subjectId','number','title','statement'].forEach(f => {
      if (t[f] == null || t[f] === '') errors.push(`[${i}] нет поля ${f}`);
    });
    if (t.subjectId && !C.subject(t.subjectId)) errors.push(`[${i}] неизвестный предмет «${t.subjectId}»`);
    else if (t.number != null && !C.partOf(t.subjectId, +t.number))
      errors.push(`[${i}] в предмете нет задания №${t.number}`);
    if (t.id && seen.has(t.id)) errors.push(`[${i}] id «${t.id}» повторяется в файле`);
    if (t.id) seen.add(t.id);
    if (t.compare && !['exact','ci','set','numeric'].includes(t.compare))
      errors.push(`[${i}] compare должен быть exact | ci | set | numeric`);
  });
  const existing = await Promise.all(arr.map(t => t.id ? repository(req).taskExists(String(t.id)) : false));
  existing.forEach((found, i) => {
    if (found) errors.push(`[${i}] id «${arr[i].id}» уже есть`);
  });
  if (errors.length) return res.status(400).json({ error:'Импорт отклонён', errors });

  await repository(req).insertTasks(arr, C.partOf);
  res.json({ ok:true, imported:arr.length });
}));

/* ── приглашения ─────────────────────────────────────────────────── */
router.post('/invites', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const { kind, subjectId, groupId, maxUses, expiresAt, note } = req.body || {};
  if (!['enrollment','group'].includes(kind)) return res.status(400).json({ error:'Неизвестный тип приглашения' });
  let subj = subjectId;
  if (kind === 'group') {
    const g = await repository(req).findGroup(groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subj = g.subject_id;
  }
  if (!await repository(req).subjectExists(subj)) return res.status(400).json({ error:'Неизвестный предмет' });

  /* код только из латиницы и цифр, без похожих друг на друга символов:
     его диктуют голосом и вставляют в адресную строку */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick4 = () => Array.from({ length:4 }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  let code = pick4() + '-' + pick4();
  while (await repository(req).inviteCodeExists(code)) code = pick4() + '-' + pick4();
  const id = uid('inv');
  const invite = await repository(req).createInvite({
    id, code, kind, tutorId:req.tutorId, subjectId:subj,
    groupId:kind === 'group' ? groupId : null, createdBy:req.user.id,
    createdAt:now(), expiresAt:expiresAt || null,
    maxUses:maxUses == null ? null : +maxUses, note:String(note || ''),
  });
  res.json({ ok:true, invite });
}));

router.post('/invites/:id/revoke', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const inv = await repository(req).findInvite(req.params.id);
  if (!inv || inv.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваше приглашение' });
  transitionInvite(inv.status, 'revoked');
  assertUpdated(
    await repository(req).revokeInvite(inv),
    'Invite', inv.id,
  );
  res.json({ ok:true });
}));

/* публичный просмотр приглашения по коду — чтобы показать, куда зовут */
router.get('/invites/:code', A.requireUser, asyncRoute(async (req, res) => {
  const C = await fullCore(req);
  const inv = C.inviteByCode(req.params.code);
  const state = C.inviteState(inv);
  if (!inv) return res.status(404).json({ error:state.label, state });
  res.json({ invite:inv, state, target:C.inviteTarget(inv),
             joined: req.studentId ? C.inviteAlreadyJoined(inv, req.studentId) : false });
}));

router.post('/invites/accept', A.requireRole('student'), asyncRoute(async (req, res) => {
  const C = await fullCore(req);
  const inv = C.inviteByCode((req.body || {}).code);
  const state = C.inviteState(inv);
  if (!state.ok) return res.status(400).json({ error:state.label });
  if (C.inviteAlreadyJoined(inv, req.studentId)) return res.status(400).json({ error:'Вы уже присоединены по этой ссылке' });
  if (inv.kind === 'guardian') return res.status(400).json({ error:'Ссылку для родителя принимает родитель' });

  await repository(req).transaction(async () => {
    if (inv.kind === 'enrollment') {
      await repository(req).addEnrollmentFromInvite({
        id:uid('e'), studentId:req.studentId, tutorId:inv.tutorId,
        subjectId:inv.subjectId, startedAt:now().slice(0, 10), inviteId:inv.id,
      });
    } else {
      await repository(req).addGroupMemberFromInvite({
        groupId:inv.groupId, studentId:req.studentId,
        joinedAt:now().slice(0, 10), inviteId:inv.id,
      });
      /* уже выданные групповые задания разворачиваем на новичка */
      const assignments = await repository(req).assignmentsForGroup(inv.groupId);
      for (const assignment of assignments) {
        for (const taskId of JSON.parse(assignment.task_ids || '[]')) {
          await ensureAttempt(req, req.studentId, taskId, { assignmentId:assignment.id, groupId:inv.groupId });
        }
      }
    }
    const used = inv.usedCount + 1;
    const nextStatus = (inv.maxUses != null && used >= inv.maxUses) ? 'used_up' : 'active';
    transitionInvite(inv.status, nextStatus);
    assertUpdated(
      await repository(req).consumeInvite(inv, used, nextStatus),
      'Invite', inv.id,
    );
  });

  await req.app.locals.services.events.publish(domainEvent({
    name:'InviteAccepted', aggregateId:inv.id,
    correlationId:req.id,
    payload:{ inviteId:inv.id, studentId:req.studentId },
  }));
  res.json({ ok:true, target:C.inviteTarget(inv) });
}));

/* ── группы ──────────────────────────────────────────────────────── */
router.post('/groups', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const { subjectId, title, level, schedule, capacity } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error:'Укажите название группы' });
  if (!await repository(req).subjectExists(subjectId)) return res.status(400).json({ error:'Неизвестный предмет' });
  const id = uid('gr');
  await repository(req).createGroup({
    id, tutorId:req.tutorId, subjectId, title:String(title).trim(),
    level:String(level || 'база'), schedule:String(schedule || ''),
    capacity:+capacity || 8, createdAt:now().slice(0, 10),
  });
  res.json({ ok:true, id });
}));

/* ── занятия ─────────────────────────────────────────────────────── */
router.post('/lessons', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const { enrollmentId, groupId, startsAt, durationMin } = req.body || {};
  if (!startsAt || isNaN(new Date(startsAt).getTime())) return res.status(400).json({ error:'Неверная дата начала' });
  let subjectId = null;
  if (enrollmentId) {
    const e = await repository(req).findEnrollment(enrollmentId);
    if (!e || e.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваш ученик' });
    subjectId = e.subject_id;
  } else if (groupId) {
    const g = await repository(req).findGroup(groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subjectId = g.subject_id;
  } else return res.status(400).json({ error:'Укажите ученика или группу' });
  const id = uid('l');
  await repository(req).createLesson({
    id, subjectId, tutorId:req.tutorId, enrollmentId:enrollmentId || null,
    groupId:groupId || null, startsAt:new Date(startsAt).toISOString(),
    durationMin:+durationMin || 60,
  });
  res.json({ ok:true, id });
}));

router.post('/lessons/:id/links', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const l = await tutorOwnsLesson(req, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ error:'Пустая ссылка' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error:'Ссылка должна начинаться с http:// или https://' });
  const type = ['call','board','material'].includes((req.body || {}).type) ? req.body.type : 'material';
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [, ''])[1].replace(/^www\./, '');
  const label = String((req.body || {}).label || '').trim() ||
    ({ call:'Созвон', board:'Доска', material:'Материал' }[type] + (host ? ' · ' + host : ''));

  const links = JSON.parse(l.links || '[]').concat({ type, label, url });
  assertUpdated(await repository(req).updateLessonLinks(l, links), 'Lesson', l.id);
  req.app.locals.live.invalidate(l.id, 'links_changed');
  res.json({ ok:true, links });
}));

router.delete('/lessons/:id/links/:index', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const l = await tutorOwnsLesson(req, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const links = JSON.parse(l.links || '[]');
  links.splice(+req.params.index, 1);
  assertUpdated(await repository(req).updateLessonLinks(l, links), 'Lesson', l.id);
  req.app.locals.live.invalidate(l.id, 'links_changed');
  res.json({ ok:true, links });
}));

router.post('/lessons/:id/tasks', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const l = await tutorOwnsLesson(req, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const taskId = String((req.body || {}).taskId || '');
  const t = await repository(req).findTask(taskId);
  if (!t) return res.status(404).json({ error:'Задача не найдена' });
  if (t.subject_id !== l.subject_id) return res.status(400).json({ error:'Задача из другого предмета' });
  const ids = JSON.parse(l.task_ids || '[]');
  if (ids.includes(taskId)) return res.status(400).json({ error:'Задача уже прикреплена' });

  await repository(req).transaction(async () => {
    assertUpdated(await repository(req).updateLessonTasks(l, ids.concat(taskId)), 'Lesson', l.id);
    for (const sid of await studentsOfLessonRow(req, l)) {
      await ensureAttempt(req, sid, taskId, { lessonId:l.id, groupId:l.group_id });
    }
  });
  req.app.locals.live.invalidate(l.id, 'tasks_changed');
  res.json({ ok:true });
}));

router.delete('/lessons/:id/tasks/:taskId', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const l = await tutorOwnsLesson(req, req.params.id);
  if (!l) return res.status(403).json({ error:'Это не ваше занятие' });
  const ids = JSON.parse(l.task_ids || '[]').filter(x => x !== req.params.taskId);
  await repository(req).transaction(async () => {
    assertUpdated(await repository(req).updateLessonTasks(l, ids), 'Lesson', l.id);
    /* нетронутые попытки убираем, начатые оставляем — это уже работа ученика */
    await repository(req).removeIssuedAttempt(l.id, req.params.taskId);
  });
  req.app.locals.live.invalidate(l.id, 'tasks_changed');
  res.json({ ok:true });
}));

router.post('/lessons/:id/status', A.requireRole('tutor'), (req, res, next) => {
  const status = (req.body || {}).status;
  if (!['planned','done','moved','cancelled','missed'].includes(status)) return res.status(400).json({ error:'Неизвестный статус' });
  req.app.locals.services.scheduling.changeLessonStatus.execute({
    lessonId:req.params.id,
    tutorId:req.tutorId,
    status,
    correlationId:req.id,
  }).then(() => {
    req.app.locals.live.invalidate(req.params.id, 'lesson_status_changed');
    res.json({ ok:true });
  }).catch(next);
});

/* ── домашние задания ────────────────────────────────────────────── */
router.post('/assignments', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const { enrollmentId, groupId, lessonId, title, dueAt, taskIds } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error:'Укажите название задания' });
  if (!Array.isArray(taskIds) || !taskIds.length) return res.status(400).json({ error:'Выберите хотя бы одну задачу' });

  let subjectId = null, students = [];
  if (enrollmentId) {
    const e = await repository(req).findEnrollment(enrollmentId);
    if (!e || e.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваш ученик' });
    subjectId = e.subject_id; students = [e.student_id];
  } else if (groupId) {
    const g = await repository(req).findGroup(groupId);
    if (!g || g.tutor_id !== req.tutorId) return res.status(403).json({ error:'Это не ваша группа' });
    subjectId = g.subject_id;
    students = await repository(req).activeGroupStudentIds(groupId);
  } else return res.status(400).json({ error:'Укажите ученика или группу' });
  if (!students.length) return res.status(400).json({ error:'В выбранной группе пока нет учеников' });

  const uniqueTaskIds = [...new Set(taskIds.map(String))];
  if (uniqueTaskIds.length !== taskIds.length) return res.status(400).json({ error:'Одна задача выбрана несколько раз' });
  for (const taskId of uniqueTaskIds) {
    const task = await repository(req).findTask(taskId);
    if (!task) return res.status(404).json({ error:`Задача «${taskId}» не найдена` });
    if (task.subject_id !== subjectId) return res.status(400).json({ error:'В Д/З есть задача из другого предмета' });
  }

  const id = uid('a');
  const assignmentStatus = transitionAssignment('draft', 'published');
  await repository(req).transaction(async () => {
    await repository(req).createAssignment({
      id, subjectId, enrollmentId:enrollmentId || null, groupId:groupId || null,
      lessonId:lessonId || null, title:String(title).trim(),
      dueAt:dueAt ? new Date(dueAt).toISOString() : now(), taskIds:uniqueTaskIds,
      status:assignmentStatus,
    });
    for (const sid of students) {
      for (const taskId of uniqueTaskIds) {
        await ensureAttempt(req, sid, taskId, { assignmentId:id, groupId:groupId || null });
      }
    }
  });
  await req.app.locals.services.events.publish(domainEvent({
    name:'AssignmentPublished', aggregateId:id,
    correlationId:req.id,
    payload:{ assignmentId:id, tutorId:req.tutorId },
  }));
  if (lessonId) req.app.locals.live.invalidate(lessonId, 'assignment_changed');
  res.json({ ok:true, id });
}));

/* ── попытки ─────────────────────────────────────────────────────── */
async function ownAttempt(req, res) {
  const a = await repository(req).findAttempt(req.params.id);
  if (!a) { res.status(404).json({ error:'Попытка не найдена' }); return null; }
  if (a.student_id !== req.studentId) { res.status(403).json({ error:'Это чужая работа' }); return null; }
  return a;
}

/* черновик и время: приходит с heartbeat раз в 15 секунд */
router.post('/attempts/:id/progress', A.requireRole('student'), asyncRoute(async (req, res) => {
  const a = await ownAttempt(req, res); if (!a) return;
  if (a.status === 'checked' || a.status === 'submitted') return res.status(400).json({ error:'Работа уже закрыта' });
  const { code, activeSeconds } = req.body || {};
  const secs = clampActiveSeconds(a.active_seconds || 0, activeSeconds);
  const nextStatus = a.status === 'issued' ? transitionAttempt(a.status, 'in_progress') : a.status;
  const update = await repository(req).updateAttemptProgress(a, {
    code:code == null ? a.code : String(code).slice(0, 20000),
    activeSeconds:secs, status:nextStatus,
    startedAt:now(),
  });
  assertUpdated(update, 'Attempt', a.id);
  await req.app.locals.live.push(a.lesson_id, a.student_id);
  res.json({ ok:true, activeSeconds:secs });
}));

/* преподаватель может поправить только черновик открытой работы.
   Учебные показатели намеренно не меняются: время, попытки и результат
   принадлежат действиям ученика и остаются единственным источником статистики. */
router.post('/attempts/:id/coach', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const a = await repository(req).findAttempt(req.params.id);
  if (!a) return res.status(404).json({ error:'Работа не найдена' });
  if (!a.lesson_id) return res.status(400).json({ error:'Править можно только черновик занятия' });
  const lesson = await tutorOwnsLesson(req, a.lesson_id);
  if (!lesson) return res.status(403).json({ error:'Это не ваше занятие' });
  if (a.status === 'checked' || a.status === 'submitted') {
    return res.status(400).json({ error:'Работа уже закрыта' });
  }
  const update = await repository(req).updateAttemptProgress(a, {
    code:String((req.body || {}).code || '').slice(0, 20000),
    activeSeconds:a.active_seconds || 0,
    status:a.status,
    startedAt:a.started_at,
  });
  assertUpdated(update, 'Attempt', a.id);
  await req.app.locals.live.push(a.lesson_id, a.student_id);
  const fresh = await repository(req).findAttempt(a.id);
  res.json({ ok:true, version:fresh && fresh.version });
}));

/* проверка ответа — эталон сравнивается только здесь */
router.post('/attempts/:id/answer', A.requireRole('student'), asyncRoute(async (req, res) => {
  const a = await ownAttempt(req, res); if (!a) return;
  if (a.status === 'checked' || a.status === 'submitted') return res.status(400).json({ error:'Работа уже закрыта' });
  const task = await repository(req).taskWithAnswer(a.task_id);
  if (!task) return res.status(404).json({ error:'Задача не найдена' });
  if (!task.autoCheck) return res.status(400).json({ error:'Это задание проверяет репетитор' });

  const value = String((req.body || {}).answer || '');
  if (!value.trim()) return res.status(400).json({ error:'Пустой ответ' });

  const C = await fullCore(req);
  const correct = C.checkAnswer(task, value);
  const tries = (a.tries || 0) + 1;
  const secs = clampActiveSeconds(a.active_seconds || 0, (req.body || {}).activeSeconds);
  const nextStatus = correct
    ? transitionAttempt(a.status, 'checked')
    : (a.status === 'issued' ? transitionAttempt(a.status, 'in_progress') : a.status);

  const update = await repository(req).updateAttemptAnswer(a, {
    answer:value, tries, isCorrect:correct ? 1 : 0,
    firstTryCorrect:(correct && tries === 1) ? 1 : 0, activeSeconds:secs,
    status:nextStatus,
    startedAt:now(), submittedAt:correct ? now() : a.submitted_at,
  });
  assertUpdated(update, 'Attempt', a.id);

  await req.app.locals.live.push(a.lesson_id, a.student_id);
  if (correct) await req.app.locals.services.events.publish(domainEvent({
    name:'AttemptChecked', aggregateId:a.id,
    correlationId:req.id,
    payload:{ attemptId:a.id, studentId:a.student_id, automatic:true },
  }));
  /* правильный ответ отдаём только после того, как задача закрыта */
  res.json({ ok:true, correct, tries, answer: correct ? null : undefined });
}));

/* отправка на ручную проверку */
router.post('/attempts/:id/submit', A.requireRole('student'), asyncRoute(async (req, res) => {
  const a = await ownAttempt(req, res); if (!a) return;
  if (a.status === 'submitted' || a.status === 'checked') return res.status(400).json({ error:'Работа уже отправлена' });
  const secs = clampActiveSeconds(a.active_seconds || 0, (req.body || {}).activeSeconds);
  const submittedStatus = transitionAttempt(a.status, a.status === 'returned' ? 'resubmitted' : 'submitted');
  const update = await repository(req).submitAttempt(a, {
    code:String((req.body || {}).code || a.code || '').slice(0, 20000),
    activeSeconds:secs, status:submittedStatus, startedAt:now(), submittedAt:now(),
  });
  assertUpdated(update, 'Attempt', a.id);
  await req.app.locals.live.push(a.lesson_id, a.student_id);
  res.json({ ok:true });
}));

/* проверка репетитором */
router.post('/attempts/:id/review', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const a = await repository(req).findAttempt(req.params.id);
  if (!a) return res.status(404).json({ error:'Работа не найдена' });
  const mine = await repository(req).tutorOwnsStudent(req.tutorId, a.student_id);
  if (!mine) return res.status(403).json({ error:'Это не ваш ученик' });

  const score = Math.max(0, Math.min(10, +(req.body || {}).score || 0));
  transitionAttempt(a.status, 'checked');
  const update = await repository(req).reviewAttempt(a, {
    isCorrect:score > 0 ? 1 : 0, score,
    comment:String((req.body || {}).comment || '').slice(0, 2000),
    reviewedBy:req.tutorId, reviewedAt:now(),
  });
  assertUpdated(update, 'Attempt', a.id);
  await req.app.locals.services.events.publish(domainEvent({
    name:'AttemptChecked', aggregateId:a.id,
    correlationId:req.id,
    payload:{ attemptId:a.id, studentId:a.student_id, automatic:false },
  }));
  await req.app.locals.live.push(a.lesson_id, a.student_id);
  res.json({ ok:true });
}));

/* ── уведомления ─────────────────────────────────────────────────── */
router.post('/prefs', A.requireUser, asyncRoute(async (req, res) => {
  const { channel, enabled } = req.body || {};
  if (!channel) return res.status(400).json({ error:'Не указан канал' });
  await repository(req).savePreference(req.user.id, String(channel), !!enabled);
  res.json({ ok:true });
}));

module.exports = router;
