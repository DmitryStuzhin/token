const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { z } = require('zod');
const A = require('./auth.js');
const legacyApi = require('./api.js');

const router = express.Router();
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const EMPTY_COLLECTIONS = [
  'subjects', 'topics', 'tasks', 'users', 'studentProfiles', 'tutorProfiles',
  'guardians', 'enrollments', 'groups', 'groupMembers', 'invites', 'goals',
  'subscriptions', 'notificationPrefs', 'lessons', 'lessonAttendance',
  'assignments', 'mockExams', 'attempts',
];
const COMMON = ['subjects', 'topics', 'users', 'studentProfiles', 'tutorProfiles', 'me'];
const SCREEN_FIELDS = {
  login: ['subjects', 'me'],
  index: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'goals',
    'subscriptions', 'lessons', 'lessonAttendance', 'assignments', 'attempts'],
  tutor: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'lessons',
    'lessonAttendance', 'assignments', 'attempts'],
  students: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'lessons',
    'lessonAttendance', 'assignments', 'attempts'],
  groups: [...COMMON, 'groups', 'groupMembers', 'invites', 'lessons',
    'lessonAttendance', 'assignments', 'attempts'],
  group: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'invites',
    'lessons', 'lessonAttendance', 'assignments', 'attempts'],
  invites: [...COMMON, 'groups', 'groupMembers', 'invites'],
  invite: [...COMMON, 'enrollments', 'groups', 'groupMembers', 'invites'],
  lesson: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'lessons',
    'lessonAttendance', 'assignments', 'attempts'],
  homework: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'lessons',
    'assignments', 'attempts'],
  task: [...COMMON, 'tasks', 'lessons', 'assignments', 'attempts'],
  'task-view': [...COMMON, 'tasks', 'lessons', 'assignments', 'attempts'],
  'task-number': [...COMMON, 'tasks'],
  'student-bank': [...COMMON, 'tasks', 'attempts'],
  'student-task-number': [...COMMON, 'tasks', 'attempts'],
  'tutor-check': [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers',
    'assignments', 'attempts'],
  stats: [...COMMON, 'tasks', 'enrollments', 'groups', 'groupMembers', 'goals',
    'lessons', 'lessonAttendance', 'assignments', 'mockExams', 'attempts'],
  bank: [...COMMON, 'tasks', 'enrollments', 'groups'],
  account: [...COMMON, 'enrollments', 'groups', 'groupMembers', 'guardians', 'goals',
    'subscriptions', 'notificationPrefs', 'lessons', 'attempts'],
  parent: [...COMMON, 'guardians', 'goals', 'subscriptions', 'lessons', 'assignments', 'attempts'],
};

const listQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['id', 'name', 'title', 'number', 'createdAt', 'startsAt', 'dueAt', 'submittedAt']).default('id'),
  order: z.enum(['asc', 'desc']).default('asc'),
  subject: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
  student: z.string().max(100).optional(),
  tutor: z.string().max(100).optional(),
  group: z.string().max(100).optional(),
  lesson: z.string().max(100).optional(),
  assignment: z.string().max(100).optional(),
});

const bodySchemas = [
  [/^\/auth\/register$/, z.object({ name:z.string().min(2).max(200), email:z.email(), password:z.string().min(10).max(200), role:z.enum(['student','tutor']), phone:z.string().max(50).optional(), tz:z.string().max(100).optional(), grade:z.coerce.number().int().min(1).max(11).optional(), school:z.string().max(300).optional(), subjects:z.array(z.string()).max(20).optional(), yearsExp:z.coerce.number().min(0).max(80).optional(), rate:z.coerce.number().min(0).optional(), meetingUrl:z.string().max(2000).optional() })],
  [/^\/auth\/login$/, z.object({ email:z.email(), password:z.string().min(1).max(200) })],
  [/^\/invites$/, z.object({ kind:z.enum(['enrollment','group']), subjectId:z.string().optional(), groupId:z.string().optional(), maxUses:z.number().int().min(1).max(10000).nullable().optional(), expiresAt:z.iso.datetime().nullable().optional(), note:z.string().max(2000).optional() })],
  [/^\/invites\/accept$/, z.object({ code:z.string().min(3).max(100) })],
  [/^\/groups$/, z.object({ subjectId:z.string(), title:z.string().min(1).max(200), level:z.string().max(100).optional(), schedule:z.string().max(500).optional(), capacity:z.number().int().min(1).max(1000).optional() })],
  [/^\/lessons$/, z.object({ enrollmentId:z.string().nullable().optional(), groupId:z.string().nullable().optional(), startsAt:z.iso.datetime(), durationMin:z.number().int().min(10).max(600).optional() })],
  [/^\/lessons\/[^/]+\/links$/, z.object({ type:z.enum(['call','board','material']).optional(), label:z.string().max(300).optional(), url:z.url() })],
  [/^\/lessons\/[^/]+\/tasks$/, z.object({ taskId:z.string().min(1).max(200) })],
  [/^\/lessons\/[^/]+\/status$/, z.object({ status:z.enum(['planned','done','moved','cancelled','missed']) })],
  [/^\/assignments$/, z.object({ enrollmentId:z.string().optional(), groupId:z.string().optional(), lessonId:z.string().nullable().optional(), title:z.string().min(1).max(300), dueAt:z.iso.datetime().optional(), taskIds:z.array(z.string()).min(1).max(500) })],
  [/^\/attempts\/[^/]+\/progress$/, z.object({ code:z.string().max(20000).optional(), activeSeconds:z.number().int().min(0).optional() })],
  [/^\/attempts\/[^/]+\/coach$/, z.object({ code:z.string().max(20000) })],
  [/^\/attempts\/[^/]+\/answer$/, z.object({ answer:z.union([z.string(),z.number()]), activeSeconds:z.number().int().min(0).optional() })],
  [/^\/attempts\/[^/]+\/submit$/, z.object({ code:z.string().max(20000).optional(), activeSeconds:z.number().int().min(0).optional() })],
  [/^\/attempts\/[^/]+\/review$/, z.object({ score:z.number().min(0).max(10), comment:z.string().max(2000).optional() })],
  [/^\/prefs$/, z.object({ channel:z.string().min(1).max(100), enabled:z.boolean() })],
  [/^\/tasks\/import$/, z.object({ tasks:z.array(z.record(z.string(), z.unknown())).min(1).max(1000) })],
];

function problem(status, title, detail, req, extensions = {}) {
  return {
    type: `https://token.local/problems/${status}`,
    title,
    status,
    detail,
    instance: req.originalUrl,
    requestId: req.id,
    ...extensions,
  };
}

function withProblemDetails(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && body.error && !body.type) {
      const titles = { 400:'Некорректный запрос', 401:'Требуется вход', 403:'Доступ запрещён',
        404:'Ресурс не найден', 409:'Конфликт', 422:'Ошибка валидации', 500:'Внутренняя ошибка' };
      res.type('application/problem+json');
      return json(problem(res.statusCode, titles[res.statusCode] || 'Ошибка', body.error, req,
        body.errors ? { errors:body.errors } : {}));
    }
    return json(body);
  };
  next();
}

function validateBody(req, res, next) {
  if (!['POST','PUT','PATCH'].includes(req.method)) return next();
  const match = bodySchemas.find(([pattern]) => pattern.test(req.path));
  if (!match) return next();
  const result = match[1].safeParse(req.body || {});
  if (!result.success) {
    return res.status(422).json({
      error: 'Тело запроса не соответствует контракту',
      errors: result.error.issues.map(issue => ({ path:issue.path.join('.'), message:issue.message })),
    });
  }
  req.body = result.data;
  next();
}

const IDEMPOTENT_OPERATIONS = [
  ['POST', /^\/invites$/], ['POST', /^\/invites\/accept$/],
  ['POST', /^\/groups$/], ['POST', /^\/lessons$/],
  ['POST', /^\/assignments$/], ['POST', /^\/tasks\/import$/],
];
const memoryIdempotency = new Map();

async function internalUserId(pool, externalId) {
  const result = await pool.query(
    'SELECT id::text FROM users WHERE id::text=$1 OR legacy_id=$1 LIMIT 1',
    [externalId],
  );
  return result.rows[0]?.id || null;
}

async function idempotency(req, res, next) {
  if (!IDEMPOTENT_OPERATIONS.some(([method, pattern]) => method === req.method && pattern.test(req.path))) {
    return next();
  }
  if (!req.user) return next();
  const key = String(req.get('Idempotency-Key') || '');
  if (key.length < 8 || key.length > 200) {
    return res.status(400).json({ error:'Для этой операции нужен Idempotency-Key длиной 8–200 символов' });
  }
  const operation = `${req.method} ${req.path}`;
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body || null)).digest('hex');
  const pool = req.app.locals.services.pool;
  let cacheKey;
  let existing;
  let postgresUserId;
  if (pool) {
    postgresUserId = await internalUserId(pool, req.user.id);
    const inserted = await pool.query(
      `INSERT INTO idempotency_keys (user_id,operation,key,request_hash)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key`,
      [postgresUserId, operation, key, requestHash],
    );
    if (!inserted.rowCount) {
      existing = (await pool.query(
        `SELECT request_hash,status_code,response_body FROM idempotency_keys
         WHERE user_id=$1 AND operation=$2 AND key=$3 AND expires_at > now()`,
        [postgresUserId, operation, key],
      )).rows[0];
    }
  } else {
    cacheKey = `${req.user.id}\u0000${operation}\u0000${key}`;
    existing = memoryIdempotency.get(cacheKey);
    if (!existing) memoryIdempotency.set(cacheKey, { request_hash:requestHash });
  }
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return res.status(409).json({ error:'Idempotency-Key уже использован с другим запросом' });
    }
    if (existing.status_code && existing.response_body) {
      res.set('Idempotency-Replayed', 'true');
      return res.status(existing.status_code).json(existing.response_body);
    }
    return res.status(409).set('Retry-After', '1').json({ error:'Запрос с таким Idempotency-Key ещё выполняется' });
  }

  let responseBody;
  const json = res.json.bind(res);
  res.json = body => { responseBody = body; return json(body); };
  res.once('finish', () => {
    if (!responseBody || res.statusCode >= 500) return;
    if (pool) {
      void pool.query(
        `UPDATE idempotency_keys SET status_code=$4,response_body=$5
         WHERE user_id=$1 AND operation=$2 AND key=$3`,
        [postgresUserId, operation, key, res.statusCode, JSON.stringify(responseBody)],
      );
    } else if (cacheKey) {
      memoryIdempotency.set(cacheKey, {
        request_hash:requestHash, status_code:res.statusCode, response_body:responseBody,
      });
    }
  });
  next();
}

function etagOf(value) {
  return `"${crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`;
}

function sendCacheable(req, res, value) {
  const etag = etagOf(value);
  res.set('ETag', etag).set('Cache-Control', 'private, no-cache');
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  return res.json(value);
}

function screenState(snapshot, screen) {
  const selected = new Set(SCREEN_FIELDS[screen] || []);
  const state = {};
  for (const name of EMPTY_COLLECTIONS) {
    if (selected.has(name) && Array.isArray(snapshot[name])) state[name] = snapshot[name];
  }
  state.me = selected.has('me') ? snapshot.me : null;
  return state;
}

router.use(withProblemDetails);
router.get('/openapi.yaml', (req, res) => {
  res.type('application/yaml').sendFile(path.join(__dirname, '..', 'docs', 'openapi.v1.yaml'));
});
router.get('/state.js', (req, res) => res.status(410).json({ error:'Используйте screen bootstrap API' }));

router.get('/screens/:screen.js', asyncRoute(async (req, res) => {
  const screen = req.params.screen;
  if (!SCREEN_FIELDS[screen]) return res.status(404).json({ error:'Неизвестный экран' });
  const state = screenState(await req.app.locals.repository.snapshot(req.user), screen);
  const payload = JSON.stringify(state).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  res.type('application/javascript').set('Cache-Control', 'private, no-cache');
  res.send(`window.__SCREEN__=${JSON.stringify(screen)};window.__STATE__=${payload};`);
}));

router.get('/screens/:screen', asyncRoute(async (req, res) => {
  const screen = req.params.screen;
  if (!SCREEN_FIELDS[screen]) return res.status(404).json({ error:'Неизвестный экран' });
  const state = screenState(await req.app.locals.repository.snapshot(req.user), screen);
  return sendCacheable(req, res, { screen, state });
}));

const RESOURCES = {
  invites:'invites', groups:'groups', students:'studentProfiles', lessons:'lessons',
  assignments:'assignments', attempts:'attempts', reviews:'attempts', tasks:'tasks',
};
router.get('/me', A.requireUser, (req, res) => sendCacheable(req, res, {
  user:{ id:req.user.id, role:req.user.role, name:req.user.name, email:req.user.email },
  profile:req.profile || null,
  home:A.ROLES[req.user.role].home,
}));
router.get('/profile', A.requireUser, asyncRoute(async (req, res) => {
  const snapshot = await req.app.locals.repository.snapshot(req.user);
  return sendCacheable(req, res, screenState(snapshot, 'account'));
}));

router.get('/lessons/:id', A.requireUser, asyncRoute(async (req, res) => {
  const snapshot = await req.app.locals.repository.snapshot(req.user);
  const lesson = snapshot.lessons.find(item => item.id === req.params.id);
  if (!lesson) return res.status(404).json({ error:'Занятие не найдено' });
  res.set('ETag', `"v${String(lesson.version)}"`).set('Cache-Control', 'private, no-cache');
  if (req.get('If-None-Match') === `"v${String(lesson.version)}"`) return res.status(304).end();
  return res.json(lesson);
}));

router.patch('/lessons/:id', A.requireRole('tutor'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    status:z.enum(['planned','done','moved','cancelled','missed']),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({
    error:'Тело запроса не соответствует контракту',
    errors:parsed.error.issues.map(issue => ({ path:issue.path.join('.'), message:issue.message })),
  });
  const lesson = await req.app.locals.repository.findOwnedLesson(req.tutorId, req.params.id);
  if (!lesson) return res.status(404).json({ error:'Занятие не найдено' });
  const expected = req.get('If-Match');
  if (!expected) return res.status(428).json({ error:'Для изменения требуется If-Match' });
  if (expected !== `"v${String(lesson.version)}"`) {
    return res.status(412).json({ error:'Версия занятия изменилась' });
  }
  await req.app.locals.services.scheduling.changeLessonStatus.execute({
    lessonId:req.params.id, tutorId:req.tutorId, status:parsed.data.status,
    correlationId:req.id,
  });
  const updated = await req.app.locals.repository.findOwnedLesson(req.tutorId, req.params.id);
  req.app.locals.live.invalidate(req.params.id, 'lesson_status_changed');
  res.set('ETag', `"v${String(updated.version)}"`);
  return res.json({ ok:true, version:updated.version });
}));

router.get('/read-models/:model', A.requireUser, asyncRoute(async (req, res) => {
  const pool = req.app.locals.services.pool;
  if (!pool) return res.status(501).json({ error:'Read-модели доступны в PostgreSQL-контуре' });
  const model = req.params.model;
  let result;
  if (model === 'student-dashboard' && req.user.role === 'student') {
    result = await pool.query(
      `SELECT COALESCE(sp.legacy_id,sp.id::text) "studentId",s.code "subjectId",
       d.solved_total "solvedTotal",d.active_seconds::integer "activeSeconds",
       d.accuracy,d.next_lesson_at "nextLessonAt",
       d.overdue_assignments "overdueAssignments",d.updated_at "updatedAt"
       FROM student_dashboard_view d
       JOIN student_profiles sp ON sp.id=d.student_id JOIN subjects s ON s.id=d.subject_id
       WHERE sp.id::text=$1 OR sp.legacy_id=$1 ORDER BY s.code`,
      [req.profile.id],
    );
  } else if (model === 'tutor-today' && req.user.role === 'tutor') {
    result = await pool.query(
      `SELECT COALESCE(l.legacy_id,l.id::text) "lessonId",l.starts_at "startsAt",
       v.status,v.student_count "studentCount",v.submitted_count "submittedCount",
       v.updated_at "updatedAt"
       FROM tutor_today_view v JOIN tutor_profiles tp ON tp.id=v.tutor_id
       JOIN lessons l ON l.id=v.lesson_id
       WHERE tp.id::text=$1 OR tp.legacy_id=$1 ORDER BY l.starts_at`,
      [req.profile.id],
    );
  } else if (model === 'assignment-progress') {
    const student = String(req.query.student || (req.user.role === 'student' ? req.profile.id : ''));
    if (!student) return res.status(422).json({ error:'Укажите student' });
    result = await pool.query(
      `SELECT COALESCE(a.legacy_id,a.id::text) "assignmentId",
       COALESCE(sp.legacy_id,sp.id::text) "studentId",p.total_tasks "totalTasks",
       p.completed_tasks "completedTasks",p.correct_tasks "correctTasks",
       p.active_seconds::integer "activeSeconds",p.status,p.updated_at "updatedAt"
       FROM assignment_progress_view p JOIN assignments a ON a.id=p.assignment_id
       JOIN student_profiles sp ON sp.id=p.student_id
       WHERE (sp.id::text=$1 OR sp.legacy_id=$1)
       AND ($2::text='student' OR EXISTS (
         SELECT 1 FROM tutor_profiles tp
         WHERE (tp.id::text=$3 OR tp.legacy_id=$3) AND (
           EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=sp.id AND e.tutor_id=tp.id)
           OR EXISTS (SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
             WHERE gm.student_id=sp.id AND g.tutor_id=tp.id))))
       ORDER BY a.due_at`,
      [student, req.user.role, req.profile.id],
    );
  } else if (model === 'student-subject-stats') {
    const student = String(req.query.student || (req.user.role === 'student' ? req.profile.id : ''));
    if (!student) return res.status(422).json({ error:'Укажите student' });
    result = await pool.query(
      `SELECT COALESCE(sp.legacy_id,sp.id::text) "studentId",s.code "subjectId",
       v.solved_total "solvedTotal",v.checked_total "checkedTotal",
       v.correct_total "correctTotal",v.active_seconds::integer "activeSeconds",
       v.accuracy,v.last_activity_at "lastActivityAt",v.updated_at "updatedAt"
       FROM student_subject_stats v JOIN student_profiles sp ON sp.id=v.student_id
       JOIN subjects s ON s.id=v.subject_id
       WHERE (sp.id::text=$1 OR sp.legacy_id=$1)
       AND ($2::text='student' OR EXISTS (
         SELECT 1 FROM tutor_profiles tp
         WHERE (tp.id::text=$3 OR tp.legacy_id=$3) AND (
           EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=sp.id AND e.tutor_id=tp.id)
           OR EXISTS (SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
             WHERE gm.student_id=sp.id AND g.tutor_id=tp.id))))
       ORDER BY s.code`,
      [student, req.user.role, req.profile.id],
    );
  } else {
    return res.status(404).json({ error:'Read-модель не найдена или недоступна роли' });
  }
  return sendCacheable(req, res, { items:result.rows, updatedAt:new Date().toISOString() });
}));

router.get('/:resource', A.requireUser, asyncRoute(async (req, res, next) => {
  const collection = RESOURCES[req.params.resource];
  if (!collection) return next();
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(422).json({
    error:'Параметры списка не соответствуют контракту',
    errors:parsed.error.issues.map(issue => ({ path:issue.path.join('.'), message:issue.message })),
  });
  const query = parsed.data;
  const snapshot = await req.app.locals.repository.snapshot(req.user);
  let items = [...(snapshot[collection] || [])];
  if (req.params.resource === 'reviews') items = items.filter(item => item.status === 'submitted');
  const filters = { subject:'subjectId', status:'status', student:'studentId', tutor:'tutorId',
    group:'groupId', lesson:'lessonId', assignment:'assignmentId' };
  for (const [queryName, field] of Object.entries(filters)) {
    if (query[queryName]) items = items.filter(item => String(item[field] || '') === query[queryName]);
  }
  const direction = query.order === 'asc' ? 1 : -1;
  items.sort((left, right) => {
    const a = left[query.sort] ?? left.id ?? '';
    const b = right[query.sort] ?? right.id ?? '';
    const primary = typeof a === 'number' && typeof b === 'number'
      ? a - b : String(a).localeCompare(String(b));
    if (primary) return primary * direction;
    return String(left.id || '').localeCompare(String(right.id || '')) * direction;
  });
  let offset = 0;
  if (query.cursor) {
    try { offset = Number(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()).offset) || 0; }
    catch { return res.status(422).json({ error:'Некорректный cursor' }); }
  }
  const pageItems = items.slice(offset, offset + query.limit);
  const nextOffset = offset + pageItems.length;
  const value = {
    items:pageItems,
    page:{ limit:query.limit, hasMore:nextOffset < items.length,
      nextCursor:nextOffset < items.length
        ? Buffer.from(JSON.stringify({ offset:nextOffset })).toString('base64url') : null },
    meta:{ total:items.length, sort:query.sort, order:query.order },
  };
  return sendCacheable(req, res, value);
}));

router.use(validateBody);
router.use(asyncRoute(idempotency));
router.use(legacyApi);

module.exports = router;
