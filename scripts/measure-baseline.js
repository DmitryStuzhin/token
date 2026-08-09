const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-baseline-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SQL_METRICS = 'true';
process.env.TOKEN_DB = path.join(workDir, 'baseline.db');

const {
  db, snapshot, resetSqlMetrics, getSqlMetrics,
} = require('../server/db.js');

const now = new Date('2026-08-08T09:00:00.000Z');
const day = 86_400_000;
const tutorCount = 20;
const studentCount = 180;
const attemptsPerStudent = 20;

function seed() {
  const tasks = db.prepare("SELECT id FROM tasks WHERE subject_id = 'inf' ORDER BY number, id LIMIT 20").all();
  const insertUser = db.prepare(`INSERT INTO users
    (id,role,name,email,pass_hash,pass_salt,phone,tz,created_at)
    VALUES (?,?,?,?,?,?,NULL,'Europe/Moscow',?)`);
  const insertTutor = db.prepare(`INSERT INTO tutor_profiles
    (id,user_id,subjects,years_exp,rate,meeting_url) VALUES (?,?,?,5,3000,'')`);
  const insertStudent = db.prepare(`INSERT INTO student_profiles
    (id,user_id,grade,school,started_at) VALUES (?,?,11,'Школа',?)`);
  const insertEnrollment = db.prepare(`INSERT INTO enrollments
    (id,student_id,tutor_id,subject_id,status,started_at,source,invite_id)
    VALUES (?,?,?,'inf','active',?,'baseline',NULL)`);
  const insertGroup = db.prepare(`INSERT INTO groups
    (id,tutor_id,subject_id,title,level,schedule,capacity,status,created_at)
    VALUES (?,?,'inf',?,'профиль','Вт, Чт 18:00',12,'active',?)`);
  const insertMember = db.prepare(`INSERT INTO group_members
    (group_id,student_id,joined_at,status,source,invite_id)
    VALUES (?,?,?,'active','baseline',NULL)`);
  const insertLesson = db.prepare(`INSERT INTO lessons
    (id,subject_id,tutor_id,enrollment_id,group_id,starts_at,duration_min,status,links,task_ids,note)
    VALUES (?,'inf',?,?,NULL,?,60,'done','[]',? ,NULL)`);
  const insertAttendance = db.prepare(`INSERT INTO lesson_attendance
    (lesson_id,student_id,status) VALUES (?,?,'present')`);
  const insertAssignment = db.prepare(`INSERT INTO assignments
    (id,subject_id,enrollment_id,group_id,lesson_id,title,due_at,task_ids)
    VALUES (?,'inf',?,NULL,NULL,?,?,?)`);
  const insertAttempt = db.prepare(`INSERT INTO attempts
    (id,task_id,student_id,subject_id,context,lesson_id,assignment_id,group_id,
     code,answer,tries,is_correct,first_try_correct,active_seconds,status,started_at,submitted_at)
    VALUES (?,?,?,'inf','homework',NULL,?,NULL,'','',1,?,?,?,'checked',?,?)`);

  db.transaction(() => {
    for (let i = 0; i < tutorCount; i += 1) {
      const userId = `baseline-user-tutor-${i}`;
      insertUser.run(userId, 'tutor', `Репетитор ${i}`, `tutor-${i}@baseline.test`, 'hash', 'salt', now.toISOString());
      insertTutor.run(`baseline-tutor-${i}`, userId, JSON.stringify(['inf']));
      insertGroup.run(`baseline-group-${i}`, `baseline-tutor-${i}`, `Группа ${i}`, now.toISOString());
    }

    for (let i = 0; i < studentCount; i += 1) {
      const userId = `baseline-user-student-${i}`;
      const studentId = `baseline-student-${i}`;
      const tutorIndex = i % tutorCount;
      const tutorId = `baseline-tutor-${tutorIndex}`;
      const enrollmentId = `baseline-enrollment-${i}`;
      const groupId = `baseline-group-${tutorIndex}`;
      const startedAt = new Date(now.getTime() - 120 * day).toISOString();

      insertUser.run(userId, 'student', `Ученик ${i}`, `student-${i}@baseline.test`, 'hash', 'salt', now.toISOString());
      insertStudent.run(studentId, userId, startedAt.slice(0, 10));
      insertEnrollment.run(enrollmentId, studentId, tutorId, startedAt.slice(0, 10));
      insertMember.run(groupId, studentId, startedAt.slice(0, 10));

      for (let lessonIndex = 0; lessonIndex < 2; lessonIndex += 1) {
        const lessonId = `baseline-lesson-${i}-${lessonIndex}`;
        const lessonAt = new Date(now.getTime() - (lessonIndex + 1) * 7 * day).toISOString();
        insertLesson.run(lessonId, tutorId, enrollmentId, lessonAt, JSON.stringify(tasks.slice(0, 5).map(item => item.id)));
        insertAttendance.run(lessonId, studentId);
      }

      const assignmentId = `baseline-assignment-${i}`;
      insertAssignment.run(
        assignmentId,
        enrollmentId,
        `Задание ${i}`,
        new Date(now.getTime() + 7 * day).toISOString(),
        JSON.stringify(tasks.slice(0, 10).map(item => item.id)),
      );

      for (let attemptIndex = 0; attemptIndex < attemptsPerStudent; attemptIndex += 1) {
        const correct = attemptIndex % 4 === 0 ? 0 : 1;
        const submittedAt = new Date(now.getTime() - (attemptIndex % 30) * day).toISOString();
        insertAttempt.run(
          `baseline-attempt-${i}-${attemptIndex}`,
          tasks[attemptIndex % tasks.length].id,
          studentId,
          assignmentId,
          correct,
          correct,
          120 + attemptIndex * 5,
          submittedAt,
          submittedAt,
        );
      }
    }
  })();
}

function measure(label, user) {
  const samples = [];
  let payload = null;
  let statements = null;
  for (let i = 0; i < 30; i += 1) {
    resetSqlMetrics();
    const started = performance.now();
    const state = snapshot(user);
    const durationMs = performance.now() - started;
    samples.push(durationMs);
    if (i === 29) {
      payload = Buffer.byteLength(JSON.stringify(state));
      statements = getSqlMetrics().statements;
    }
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    samples: samples.length,
    averageMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
    p95Ms: Number(samples[Math.floor(samples.length * 0.95) - 1].toFixed(3)),
    maxMs: Number(samples[samples.length - 1].toFixed(3)),
    payloadBytes: payload,
    sqlStatements: statements,
  };
}

try {
  seed();
  const result = {
    dataset: {
      users: tutorCount + studentCount,
      tutors: tutorCount,
      students: studentCount,
      lessons: studentCount * 2,
      assignments: studentCount,
      attempts: studentCount * attemptsPerStudent,
    },
    measurements: [
      measure('guest', null),
      measure('student', { id: 'baseline-user-student-0', role: 'student' }),
      measure('tutor', { id: 'baseline-user-tutor-0', role: 'tutor' }),
    ],
    memory: {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  db.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
