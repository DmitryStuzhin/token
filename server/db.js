/* ═══════════════════════════════════════════════════════════════════
   БАЗА ДАННЫХ

   SQLite. Схема повторяет доменную модель из docs/domain-model.excalidraw.
   Справочники (предметы, темы, банк задач) заполняются при первом запуске
   из shared/domain.js — тем же кодом, что раньше работал в браузере.

   Наружу отдаётся snapshot(userId): срез данных, которые этому
   пользователю положено видеть. Именно он уходит на клиент.
   ═══════════════════════════════════════════════════════════════════ */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Domain = require('../shared/domain.js');
const { loadConfig } = require('./config.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const config = loadConfig();
const FILE = config.databaseFile;
let sqlQueryCount = 0;

const db = new Database(FILE, config.sqlMetrics ? { verbose: () => { sqlQueryCount += 1; } } : {});
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ── схема ───────────────────────────────────────────────────────── */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
  phone TEXT, tz TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, requested_ip TEXT);
CREATE INDEX IF NOT EXISTS idx_account_tokens_lookup ON account_tokens(purpose, token_hash, expires_at);

CREATE TABLE IF NOT EXISTS lesson_boards (
  lesson_id TEXT PRIMARY KEY, elements TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id, expires_at);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, ip TEXT,
  user_agent TEXT, metadata TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, occurred_at);

CREATE TABLE IF NOT EXISTS user_consents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL, document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL, ip TEXT, user_agent TEXT,
  UNIQUE(user_id, consent_type, document_version));
CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents(user_id, accepted_at);

CREATE TABLE IF NOT EXISTS student_profiles (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  grade INTEGER, school TEXT, started_at TEXT);

CREATE TABLE IF NOT EXISTS tutor_profiles (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  subjects TEXT NOT NULL, years_exp INTEGER, rate INTEGER, meeting_url TEXT);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, name TEXT, short TEXT, slug TEXT, color TEXT, exam TEXT);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, number INTEGER NOT NULL,
  topic_id TEXT, title TEXT, statement TEXT, answer TEXT,
  answer_type TEXT, compare TEXT, tolerance REAL,
  auto_check INTEGER, difficulty INTEGER, source TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_subject ON tasks(subject_id, number);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, tutor_id TEXT NOT NULL,
  subject_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT,
  source TEXT, invite_id TEXT);
CREATE INDEX IF NOT EXISTS idx_enr_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enr_tutor ON enrollments(tutor_id);

CREATE TABLE IF NOT EXISTS student_rate_history (
  tutor_id TEXT NOT NULL, student_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK (rate >= 0), effective_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (tutor_id, student_id, subject_id, effective_at));

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, tutor_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  title TEXT NOT NULL, level TEXT, schedule TEXT, capacity INTEGER,
  status TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL, student_id TEXT NOT NULL, joined_at TEXT,
  status TEXT, source TEXT, invite_id TEXT, PRIMARY KEY (group_id, student_id));

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  tutor_id TEXT, subject_id TEXT, group_id TEXT, student_id TEXT,
  created_by TEXT, created_at TEXT, expires_at TEXT,
  max_uses INTEGER, used_count INTEGER DEFAULT 0, status TEXT, note TEXT,
  version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, tutor_id TEXT NOT NULL,
  enrollment_id TEXT, group_id TEXT, starts_at TEXT NOT NULL,
  duration_min INTEGER, status TEXT, links TEXT, task_ids TEXT, note TEXT,
  version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_lessons_tutor ON lessons(tutor_id, starts_at);

CREATE TABLE IF NOT EXISTS lesson_attendance (
  lesson_id TEXT NOT NULL, student_id TEXT NOT NULL, status TEXT,
  PRIMARY KEY (lesson_id, student_id));

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, enrollment_id TEXT, group_id TEXT,
  lesson_id TEXT, title TEXT NOT NULL, due_at TEXT, task_ids TEXT,
  status TEXT NOT NULL DEFAULT 'published', version INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, student_id TEXT NOT NULL,
  subject_id TEXT, context TEXT, lesson_id TEXT, assignment_id TEXT, group_id TEXT,
  code TEXT, answer TEXT, tries INTEGER DEFAULT 0,
  is_correct INTEGER, first_try_correct INTEGER, active_seconds INTEGER DEFAULT 0,
  status TEXT, started_at TEXT, submitted_at TEXT,
  review_score INTEGER, review_comment TEXT, reviewed_by TEXT, reviewed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_att_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_att_lesson ON attempts(lesson_id);
CREATE INDEX IF NOT EXISTS idx_att_assignment ON attempts(assignment_id);

CREATE TABLE IF NOT EXISTS goals (
  student_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  target_score INTEGER, exam_date TEXT, PRIMARY KEY (student_id, subject_id));

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, payer_user_id TEXT,
  plan TEXT, lessons_left INTEGER, lessons_total INTEGER, price INTEGER,
  next_charge_at TEXT, status TEXT);

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id TEXT NOT NULL, channel TEXT NOT NULL, enabled INTEGER,
  handle TEXT, minutes_before INTEGER, PRIMARY KEY (user_id, channel));

CREATE TABLE IF NOT EXISTS mock_exams (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  variant TEXT, date TEXT, items TEXT);

CREATE TABLE IF NOT EXISTS enrollment_history (
  id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
  reason TEXT, changed_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempt_reviews (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, reviewer_tutor_id TEXT NOT NULL,
  score INTEGER NOT NULL, comment TEXT, decision TEXT NOT NULL, rubric_scores TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attempt_history (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
  changed_by TEXT, snapshot TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS score_scales (
  subject_id TEXT NOT NULL, version TEXT NOT NULL, mapping TEXT NOT NULL,
  effective_from TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(subject_id,version));
`);

/* Expand-миграции для существующих SQLite-файлов. Удаление и переименование
   колонок намеренно не выполняются при старте приложения. */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('invites', 'version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('lessons', 'version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('assignments', 'status', "TEXT NOT NULL DEFAULT 'published'");
ensureColumn('assignments', 'version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('attempts', 'version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('enrollments', 'ended_at', 'TEXT');
ensureColumn('enrollments', 'status_reason', 'TEXT');
ensureColumn('group_members', 'old_assignments_policy', "TEXT NOT NULL DEFAULT 'from_join_date'");
ensureColumn('lessons', 'recurrence_id', 'TEXT');
ensureColumn('lessons', 'recurrence_rule', 'TEXT');
ensureColumn('lessons', 'status_reason', 'TEXT');
ensureColumn('lessons', 'original_starts_at', 'TEXT');
ensureColumn('assignments', 'opens_at', 'TEXT');
ensureColumn('assignments', 'late_policy', "TEXT NOT NULL DEFAULT 'allow'");
ensureColumn('attempts', 'rubric', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('attempts', 'rubric_scores', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('mock_exams', 'scale_version', "TEXT NOT NULL DEFAULT 'v1'");
ensureColumn('tasks', 'published_at', 'TEXT');
ensureColumn('tasks', 'task_type', "TEXT NOT NULL DEFAULT 'answer'");
ensureColumn('tasks', 'attachments', "TEXT NOT NULL DEFAULT '[]'");
db.prepare("UPDATE tasks SET published_at = datetime('now') WHERE published_at IS NULL").run();
db.prepare("UPDATE tasks SET published_at = replace(published_at, ' ', 'T') || 'Z' WHERE published_at NOT LIKE '%T%'").run();
ensureColumn('account_tokens', 'code_hash', 'TEXT');
ensureColumn('account_tokens', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'email_verified_at', 'TEXT');
db.prepare('UPDATE users SET email_verified_at=created_at WHERE email_verified_at IS NULL').run();

/* ── заполнение справочников ─────────────────────────────────────── */
function seedReference() {
  const upsertSubject = db.prepare(`INSERT INTO subjects (id,name,short,slug,color,exam)
    VALUES (@id,@name,@short,@slug,@color,@exam)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, short=excluded.short,
      slug=excluded.slug, color=excluded.color, exam=excluded.exam`);
  db.transaction(rows => rows.forEach(s => upsertSubject.run({
      id:s.id, name:s.name, short:s.short, slug:s.slug, color:s.color,
      exam: JSON.stringify(s.exam),
    })))(Domain.subjects);
  const haveTopics = db.prepare('SELECT COUNT(*) n FROM topics').get().n;
  if (!haveTopics) {
    const ins = db.prepare('INSERT INTO topics (id,subject_id,name) VALUES (?,?,?)');
    db.transaction(rows => rows.forEach(t => ins.run(t.id, t.subjectId, t.name)))(Domain.topics);
  }
  const haveTasks = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  if (!haveTasks) {
    const ins = db.prepare(`INSERT INTO tasks
      (id,subject_id,number,topic_id,title,statement,answer,answer_type,compare,tolerance,auto_check,difficulty,source,published_at,task_type,attachments)
      VALUES (@id,@subjectId,@number,@topicId,@title,@statement,@answer,@answerType,@compare,@tolerance,@autoCheck,@difficulty,@source,@publishedAt,@taskType,@attachments)`);
    db.transaction(rows => rows.forEach(t => ins.run({
      ...t, autoCheck: t.autoCheck ? 1 : 0, tolerance: t.tolerance || 0,
      publishedAt:t.publishedAt || new Date().toISOString(),
      taskType:t.taskType || 'answer', attachments:JSON.stringify(t.attachments || []),
    })))(Domain.generateTasks());
  }
  const syncGeneratedType = db.prepare("UPDATE tasks SET task_type = ?, attachments = ? WHERE id = ? AND source = 'generated'");
  db.transaction(rows => rows.forEach(t => syncGeneratedType.run(
    t.taskType || 'answer', JSON.stringify(t.attachments || []), t.id,
  )))(Domain.generateTasks());
}
seedReference();

/* ── чтение: строки БД → объекты доменной модели ─────────────────── */
const J = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };

const rowSubject = r => ({ id:r.id, name:r.name, short:r.short, slug:r.slug, color:r.color, exam:J(r.exam, {}) });
const rowTopic   = r => ({ id:r.id, subjectId:r.subject_id, name:r.name });
const rowTask    = (r, withAnswer) => Object.assign({
  id:r.id, subjectId:r.subject_id, number:r.number, topicId:r.topic_id,
  title:r.title, statement:r.statement, answerType:r.answer_type, compare:r.compare,
  tolerance:r.tolerance, autoCheck:!!r.auto_check, difficulty:r.difficulty, source:r.source,
  publishedAt:r.published_at, taskType:r.task_type || 'answer', attachments:J(r.attachments, []),
}, withAnswer ? { answer:r.answer } : {});
const rowUser    = r => ({ id:r.id, role:r.role, name:r.name, email:r.email, phone:r.phone, tz:r.tz, createdAt:r.created_at });
const rowStudent = r => ({ id:r.id, userId:r.user_id, grade:r.grade, school:r.school, startedAt:r.started_at });
const rowTutor   = r => ({ id:r.id, userId:r.user_id, subjects:J(r.subjects, []), yearsExp:r.years_exp, rate:r.rate, meetingUrl:r.meeting_url });
const rowEnr     = r => ({ id:r.id, studentId:r.student_id, tutorId:r.tutor_id, subjectId:r.subject_id, status:r.status, startedAt:r.started_at, endedAt:r.ended_at, statusReason:r.status_reason, source:r.source, inviteId:r.invite_id });
const rowStudentRate = r => ({ tutorId:r.tutor_id, studentId:r.student_id, subjectId:r.subject_id, rate:r.rate, effectiveAt:r.effective_at, updatedAt:r.updated_at });
const rowGroup   = r => ({ id:r.id, tutorId:r.tutor_id, subjectId:r.subject_id, title:r.title, level:r.level, schedule:r.schedule, capacity:r.capacity, status:r.status, createdAt:r.created_at });
const rowMember  = r => ({ groupId:r.group_id, studentId:r.student_id, joinedAt:r.joined_at, status:r.status, source:r.source, inviteId:r.invite_id, oldAssignmentsPolicy:r.old_assignments_policy || 'from_join_date' });
const rowInvite  = r => ({ id:r.id, code:r.code, kind:r.kind, tutorId:r.tutor_id, subjectId:r.subject_id, groupId:r.group_id, studentId:r.student_id, createdBy:r.created_by, createdAt:r.created_at, expiresAt:r.expires_at, maxUses:r.max_uses, usedCount:r.used_count, status:r.status, note:r.note, version:r.version });
const rowLesson  = r => ({ id:r.id, subjectId:r.subject_id, tutorId:r.tutor_id, enrollmentId:r.enrollment_id, groupId:r.group_id, startsAt:r.starts_at, durationMin:r.duration_min, status:r.status, recurrenceId:r.recurrence_id, recurrenceRule:J(r.recurrence_rule, null), statusReason:r.status_reason, originalStartsAt:r.original_starts_at, links:J(r.links, []), taskIds:J(r.task_ids, []), note:J(r.note, null), version:r.version });
const rowAtt     = r => ({ lessonId:r.lesson_id, studentId:r.student_id, status:r.status });
const rowAsg     = r => ({ id:r.id, subjectId:r.subject_id, enrollmentId:r.enrollment_id, groupId:r.group_id, lessonId:r.lesson_id, title:r.title, opensAt:r.opens_at, dueAt:r.due_at, latePolicy:r.late_policy || 'allow', taskIds:J(r.task_ids, []), status:r.status, version:r.version });
const rowAttempt = r => ({ id:r.id, taskId:r.task_id, studentId:r.student_id, subjectId:r.subject_id, context:r.context, lessonId:r.lesson_id, assignmentId:r.assignment_id, groupId:r.group_id, code:r.code || '', answer:r.answer || '', tries:r.tries || 0, isCorrect: r.is_correct == null ? null : !!r.is_correct, firstTryCorrect: r.first_try_correct == null ? null : !!r.first_try_correct, activeSeconds:r.active_seconds || 0, status:r.status, startedAt:r.started_at, submittedAt:r.submitted_at, reviewScore:r.review_score, reviewComment:r.review_comment, reviewedAt:r.reviewed_at, rubric:J(r.rubric, []), rubricScores:J(r.rubric_scores, {}), version:r.version });
const rowGoal    = r => ({ studentId:r.student_id, subjectId:r.subject_id, targetScore:r.target_score, examDate:r.exam_date });
const rowSub     = r => ({ id:r.id, studentId:r.student_id, payerUserId:r.payer_user_id, plan:r.plan, lessonsLeft:r.lessons_left, lessonsTotal:r.lessons_total, price:r.price, nextChargeAt:r.next_charge_at, status:r.status });
const rowPref    = r => ({ userId:r.user_id, channel:r.channel, enabled:!!r.enabled, handle:r.handle, minutesBefore:r.minutes_before });
const rowMock    = r => ({ id:r.id, studentId:r.student_id, subjectId:r.subject_id, variant:r.variant, date:r.date, items:J(r.items, []), scaleVersion:r.scale_version || 'v1' });

const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);

const reference = () => ({
  subjects: all('SELECT * FROM subjects').map(rowSubject),
  topics:   all('SELECT * FROM topics').map(rowTopic),
});

/* Задачи без эталонных ответов — ответы не покидают сервер. */
const publicTasks = () => all('SELECT * FROM tasks ORDER BY subject_id, number').map(r => rowTask(r, false));
const taskWithAnswer = id => { const r = one('SELECT * FROM tasks WHERE id = ?', id); return r ? rowTask(r, true) : null; };

/* Полное состояние без фильтров — только для внутренней логики сервера
   (валидация приглашений, прав, импорта). Наружу не отдаётся никогда. */
function fullState() {
  return Object.assign(reference(), {
    tasks: all('SELECT * FROM tasks').map(r => rowTask(r, true)),
    users: all('SELECT * FROM users').map(rowUser),
    studentProfiles: all('SELECT * FROM student_profiles').map(rowStudent),
    tutorProfiles: all('SELECT * FROM tutor_profiles').map(rowTutor),
    guardians: [],
    enrollments: all('SELECT * FROM enrollments').map(rowEnr),
    studentRates: all('SELECT * FROM student_rate_history').map(rowStudentRate),
    groups: all('SELECT * FROM groups').map(rowGroup),
    groupMembers: all('SELECT * FROM group_members').map(rowMember),
    invites: all('SELECT * FROM invites').map(rowInvite),
    goals: all('SELECT * FROM goals').map(rowGoal),
    subscriptions: all('SELECT * FROM subscriptions').map(rowSub),
    notificationPrefs: all('SELECT * FROM notification_prefs').map(rowPref),
    lessons: all('SELECT * FROM lessons').map(rowLesson),
    lessonAttendance: all('SELECT * FROM lesson_attendance').map(rowAtt),
    assignments: all('SELECT * FROM assignments').map(rowAsg),
    mockExams: all('SELECT * FROM mock_exams').map(rowMock),
    attempts: all('SELECT * FROM attempts').map(rowAttempt),
    me: null,
  });
}

/* ── снимок для пользователя ─────────────────────────────────────────
   Возвращаем только то, что этой роли положено видеть. Ученик не
   получает чужих попыток, репетитор — только своих учеников.
   ──────────────────────────────────────────────────────────────────── */
function snapshot(user) {
  const base = Object.assign(reference(), {
    tasks: publicTasks(),
    users: [], studentProfiles: [], tutorProfiles: [], guardians: [],
    enrollments: [], studentRates: [], groups: [], groupMembers: [], invites: [],
    goals: [], subscriptions: [], notificationPrefs: [],
    lessons: [], lessonAttendance: [], assignments: [], mockExams: [], attempts: [],
    me: null,
  });
  if (!user) return base;

  base.me = rowUser(one('SELECT * FROM users WHERE id = ?', user.id));

  const studentIds = new Set();
  const tutorIds = new Set();

  if (user.role === 'student') {
    const sp = one('SELECT * FROM student_profiles WHERE user_id = ?', user.id);
    if (sp) studentIds.add(sp.id);
  } else if (user.role === 'tutor') {
    const tp = one('SELECT * FROM tutor_profiles WHERE user_id = ?', user.id);
    if (tp) {
      tutorIds.add(tp.id);
      all('SELECT student_id FROM enrollments WHERE tutor_id = ?', tp.id).forEach(r => studentIds.add(r.student_id));
      all(`SELECT gm.student_id FROM group_members gm
           JOIN groups g ON g.id = gm.group_id WHERE g.tutor_id = ?`, tp.id).forEach(r => studentIds.add(r.student_id));
    }
  }

  const sids = [...studentIds];
  const inSids = sids.length ? `(${sids.map(() => '?').join(',')})` : '(NULL)';

  base.studentProfiles = sids.length ? all(`SELECT * FROM student_profiles WHERE id IN ${inSids}`, ...sids).map(rowStudent) : [];

  /* профили репетиторов: свой либо тех, к кому ученик привязан */
  let tutorRows = [];
  if (user.role === 'tutor') {
    tutorRows = all('SELECT * FROM tutor_profiles WHERE user_id = ?', user.id);
  } else if (sids.length) {
    tutorRows = all(`SELECT DISTINCT tp.* FROM tutor_profiles tp
      WHERE tp.id IN (SELECT tutor_id FROM enrollments WHERE student_id IN ${inSids})
         OR tp.id IN (SELECT g.tutor_id FROM groups g
                      JOIN group_members gm ON gm.group_id = g.id WHERE gm.student_id IN ${inSids})`,
      ...sids, ...sids);
  }
  base.tutorProfiles = tutorRows.map(rowTutor);
  tutorRows.forEach(r => tutorIds.add(r.id));

  /* пользователи, чьи имена нужны интерфейсу */
  const userIds = new Set([user.id]);
  base.studentProfiles.forEach(p => userIds.add(p.userId));
  base.tutorProfiles.forEach(p => userIds.add(p.userId));
  const uids = [...userIds];
  base.users = all(`SELECT * FROM users WHERE id IN (${uids.map(() => '?').join(',')})`, ...uids).map(rowUser);

  if (sids.length) {
    base.enrollments = all(`SELECT * FROM enrollments WHERE student_id IN ${inSids}`, ...sids).map(rowEnr);
    base.groupMembers = all(`SELECT * FROM group_members WHERE student_id IN ${inSids}`, ...sids).map(rowMember);
    base.goals = all(`SELECT * FROM goals WHERE student_id IN ${inSids}`, ...sids).map(rowGoal);
    base.subscriptions = all(`SELECT * FROM subscriptions WHERE student_id IN ${inSids}`, ...sids).map(rowSub);
    base.mockExams = all(`SELECT * FROM mock_exams WHERE student_id IN ${inSids}`, ...sids).map(rowMock);
    base.attempts = all(`SELECT * FROM attempts WHERE student_id IN ${inSids}`, ...sids).map(rowAttempt);
  }
  if (user.role === 'tutor' && tutorIds.size) {
    base.studentRates = all('SELECT * FROM student_rate_history WHERE tutor_id = ?', [...tutorIds][0]).map(rowStudentRate);
  }

  const tids = [...tutorIds];
  if (tids.length) {
    const inT = `(${tids.map(() => '?').join(',')})`;
    base.groups = all(`SELECT * FROM groups WHERE tutor_id IN ${inT}`, ...tids).map(rowGroup);
    if (user.role === 'tutor') base.invites = all(`SELECT * FROM invites WHERE tutor_id IN ${inT}`, ...tids).map(rowInvite);
  }
  /* группы, в которых состоит ученик, даже если репетитор другой */
  base.groupMembers.forEach(m => {
    if (!base.groups.some(g => g.id === m.groupId)) {
      const g = one('SELECT * FROM groups WHERE id = ?', m.groupId);
      if (g) base.groups.push(rowGroup(g));
    }
  });
  /* состав групп целиком — нужен репетитору и для «кто на занятии» */
  base.groups.forEach(g => {
    all('SELECT * FROM group_members WHERE group_id = ?', g.id).forEach(r => {
      if (!base.groupMembers.some(m => m.groupId === r.group_id && m.studentId === r.student_id))
        base.groupMembers.push(rowMember(r));
    });
  });

  const eids = base.enrollments.map(e => e.id);
  const gids = base.groups.map(g => g.id);
  const holders = [...eids, ...gids];
  if (holders.length) {
    const ph = holders.map(() => '?').join(',');
    base.lessons = all(`SELECT * FROM lessons WHERE enrollment_id IN (${ph}) OR group_id IN (${ph})`,
      ...holders, ...holders).map(rowLesson);
    if (user.role === 'student') {
      base.lessons = base.lessons.map(lesson => lesson.note?.visibility === 'private'
        ? { ...lesson, note:null }
        : lesson);
    }
    base.assignments = all(`SELECT * FROM assignments WHERE enrollment_id IN (${ph}) OR group_id IN (${ph})`,
      ...holders, ...holders).map(rowAsg);
  }
  if (base.lessons.length) {
    const lph = base.lessons.map(() => '?').join(',');
    base.lessonAttendance = all(`SELECT * FROM lesson_attendance WHERE lesson_id IN (${lph})`,
      ...base.lessons.map(l => l.id)).map(rowAtt);
  }

  /* репетитору нужны попытки его учеников по его занятиям и заданиям */
  if (user.role === 'tutor' && sids.length) {
    base.attempts = all(`SELECT * FROM attempts WHERE student_id IN ${inSids}`, ...sids).map(rowAttempt);
    base.notificationPrefs = [];
  } else {
    base.notificationPrefs = all('SELECT * FROM notification_prefs WHERE user_id = ?', user.id).map(rowPref);
  }
  return base;
}

const resetSqlMetrics = () => { sqlQueryCount = 0; };
const getSqlMetrics = () => ({ statements: sqlQueryCount });

module.exports = { db, all, one, snapshot, fullState, reference, publicTasks, taskWithAnswer,
                   resetSqlMetrics, getSqlMetrics,
                   rows: { rowUser, rowStudent, rowTutor, rowEnr, rowGroup, rowMember,
                           rowInvite, rowLesson, rowAsg, rowAttempt, rowTask } };
