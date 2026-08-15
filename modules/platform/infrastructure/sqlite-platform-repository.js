const {
  db,
  snapshot,
  fullState,
  taskWithAnswer,
  publicTasks,
  rows,
} = require('../../../server/db.js');

class SqlitePlatformRepository {
  constructor() {
    this.writeQueue = Promise.resolve();
  }
  snapshot(user) {
    return snapshot(user);
  }
  fullState() {
    return fullState();
  }
  publicTasks() {
    return publicTasks();
  }
  taskWithAnswer(id) {
    return taskWithAnswer(id);
  }
  async loadBoard(lessonId) {
    const row = db.prepare('SELECT elements FROM lesson_boards WHERE lesson_id=?').get(lessonId);
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.elements);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async saveBoard(lessonId, elements) {
    db.prepare(
      `INSERT INTO lesson_boards (lesson_id,elements,updated_at) VALUES (?,?,?)
      ON CONFLICT(lesson_id) DO UPDATE SET elements=excluded.elements,updated_at=excluded.updated_at`,
    ).run(lessonId, JSON.stringify(elements), new Date().toISOString());
  }
  async transaction(work) {
    let release;
    const previous = this.writeQueue;
    this.writeQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }

  findTask(id) {
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
  }
  taskExists(id) {
    return !!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  }
  subjectExists(id) {
    return !!db.prepare('SELECT id FROM subjects WHERE id = ?').get(id);
  }
  async insertTasks(items, partOf) {
    const insert = db.prepare(`INSERT INTO tasks
      (id,subject_id,number,topic_id,title,statement,answer,answer_type,compare,tolerance,auto_check,difficulty,source,published_at,task_type,attachments)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await this.transaction(() =>
      items.forEach((task) => {
        const part = partOf(task.subjectId, Number(task.number)) || {};
        const answer = task.answer == null ? '' : String(task.answer);
        insert.run(
          String(task.id),
          task.subjectId,
          Number(task.number),
          task.topicId || part.topicId || null,
          String(task.title),
          String(task.statement),
          answer,
          task.answerType || 'string',
          task.compare || 'exact',
          task.tolerance || 0,
          (task.autoCheck != null ? !!task.autoCheck : !!answer.trim()) ? 1 : 0,
          task.difficulty || 2,
          task.source || 'import',
          task.publishedAt || new Date().toISOString(),
          task.taskType || 'answer',
          JSON.stringify(task.attachments || []),
        );
      }),
    );
  }

  findGroup(id) {
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) || null;
  }
  findEnrollment(id) {
    return db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id) || null;
  }
  tutorOwnsStudentSubject(tutorId, studentId, subjectId) {
    return !!db
      .prepare(
        `SELECT 1 FROM enrollments
      WHERE tutor_id=? AND student_id=? AND subject_id=? AND status='active'
      UNION ALL
      SELECT 1 FROM group_members gm JOIN groups g ON g.id=gm.group_id
      WHERE g.tutor_id=? AND gm.student_id=? AND g.subject_id=? AND gm.status='active'
      LIMIT 1`,
      )
      .get(tutorId, studentId, subjectId, tutorId, studentId, subjectId);
  }
  setStudentRate(input) {
    return db
      .prepare(
        `INSERT INTO student_rate_history (tutor_id,student_id,subject_id,rate,effective_at,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(tutor_id,student_id,subject_id,effective_at)
      DO UPDATE SET rate=excluded.rate,updated_at=excluded.updated_at`,
      )
      .run(
        input.tutorId,
        input.studentId,
        input.subjectId,
        input.rate,
        input.effectiveAt,
        input.updatedAt,
      );
  }
  activeGroupStudentIds(groupId) {
    return db
      .prepare("SELECT student_id FROM group_members WHERE group_id = ? AND status = 'active'")
      .all(groupId)
      .map((row) => row.student_id);
  }
  createGroup(input) {
    db.prepare(
      `INSERT INTO groups (id,tutor_id,subject_id,title,level,schedule,capacity,status,created_at)
                VALUES (?,?,?,?,?,?,?, 'recruiting', ?)`,
    ).run(
      input.id,
      input.tutorId,
      input.subjectId,
      input.title,
      input.level,
      input.schedule,
      input.capacity,
      input.createdAt,
    );
  }
  updateProfile(userId, role, input) {
    db.prepare('UPDATE users SET name=?,phone=?,tz=? WHERE id=?').run(
      input.name,
      input.phone,
      input.tz,
      userId,
    );
    if (role === 'student')
      db.prepare('UPDATE student_profiles SET grade=?,school=? WHERE user_id=?').run(
        input.grade,
        input.school,
        userId,
      );
    else
      db.prepare('UPDATE tutor_profiles SET years_exp=?,rate=?,meeting_url=? WHERE user_id=?').run(
        input.yearsExp,
        input.rate,
        input.meetingUrl,
        userId,
      );
  }
  updateEnrollment(enrollment, status, reason, actor) {
    const at = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE enrollments SET status=?,status_reason=?,ended_at=? WHERE id=?').run(
        status,
        reason,
        status === 'closed' ? at.slice(0, 10) : null,
        enrollment.id,
      );
      db.prepare('INSERT INTO enrollment_history VALUES (?,?,?,?,?,?,?)').run(
        `eh_${Date.now()}`,
        enrollment.id,
        enrollment.status,
        status,
        reason,
        actor,
        at,
      );
    });
    tx();
  }
  updateGroup(group, input) {
    return db
      .prepare('UPDATE groups SET title=?,level=?,schedule=?,capacity=?,status=? WHERE id=?')
      .run(input.title, input.level, input.schedule, input.capacity, input.status, group.id);
  }
  updateGroupMember(groupId, studentId, status, policy) {
    return db
      .prepare(
        'UPDATE group_members SET status=?,old_assignments_policy=? WHERE group_id=? AND student_id=?',
      )
      .run(status, policy, groupId, studentId);
  }
  lessonConflicts(tutorId, startsAt, durationMin, studentIds, exceptId = null) {
    const end = new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString();
    const tutor = db
      .prepare(
        "SELECT id FROM lessons WHERE tutor_id=? AND id<>IFNULL(?, '') AND status='planned' AND starts_at < ? AND datetime(starts_at,'+'||duration_min||' minutes') > ? LIMIT 1",
      )
      .get(tutorId, exceptId, end, startsAt);
    if (tutor) return tutor;
    for (const sid of studentIds) {
      const hit = db
        .prepare(
          "SELECT l.id FROM lessons l LEFT JOIN enrollments e ON e.id=l.enrollment_id LEFT JOIN group_members gm ON gm.group_id=l.group_id AND gm.status='active' WHERE l.id<>IFNULL(?, '') AND l.status='planned' AND (e.student_id=? OR gm.student_id=?) AND l.starts_at < ? AND datetime(l.starts_at,'+'||l.duration_min||' minutes') > ? LIMIT 1",
        )
        .get(exceptId, sid, sid, end, startsAt);
      if (hit) return hit;
    }
    return null;
  }
  updateLessonSchedule(lesson, input) {
    return db
      .prepare(
        'UPDATE lessons SET starts_at=?,duration_min=?,status=?,status_reason=?,original_starts_at=IFNULL(original_starts_at,starts_at),version=version+1 WHERE id=? AND version=?',
      )
      .run(
        input.startsAt,
        input.durationMin,
        input.status,
        input.reason,
        lesson.id,
        lesson.version,
      );
  }
  setAttendance(lessonId, studentId, status) {
    return db
      .prepare(
        'INSERT INTO lesson_attendance(lesson_id,student_id,status) VALUES(?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status',
      )
      .run(lessonId, studentId, status);
  }
  updateAssignment(assignment, input) {
    return db
      .prepare(
        'UPDATE assignments SET title=?,opens_at=?,due_at=?,late_policy=?,status=?,version=version+1 WHERE id=? AND version=?',
      )
      .run(
        input.title,
        input.opensAt,
        input.dueAt,
        input.latePolicy,
        input.status,
        assignment.id,
        assignment.version,
      );
  }
  findAssignment(id) {
    return db.prepare('SELECT * FROM assignments WHERE id=?').get(id) || null;
  }
  returnAttempt(attempt, input) {
    db.prepare(
      "UPDATE attempts SET status='returned',review_comment=?,reviewed_by=?,reviewed_at=?,rubric=?,rubric_scores=?,version=version+1 WHERE id=? AND version=?",
    ).run(
      input.comment,
      input.reviewedBy,
      input.reviewedAt,
      JSON.stringify(input.rubric || []),
      JSON.stringify(input.rubricScores || {}),
      attempt.id,
      attempt.version,
    );
    return { changes: 1 };
  }
  saveGoal(input) {
    db.prepare(
      'INSERT INTO goals(student_id,subject_id,target_score,exam_date) VALUES(?,?,?,?) ON CONFLICT(student_id,subject_id) DO UPDATE SET target_score=excluded.target_score,exam_date=excluded.exam_date',
    ).run(input.studentId, input.subjectId, input.targetScore, input.examDate);
  }
  createMockExam(input) {
    db.prepare(
      'INSERT INTO mock_exams(id,student_id,subject_id,variant,date,items,scale_version) VALUES(?,?,?,?,?,?,?)',
    ).run(
      input.id,
      input.studentId,
      input.subjectId,
      input.variant,
      input.date,
      JSON.stringify(input.items),
      input.scaleVersion,
    );
  }
  findMockExam(id) {
    return db.prepare('SELECT * FROM mock_exams WHERE id=?').get(id) || null;
  }
  updateMockExam(input) {
    return db
      .prepare('UPDATE mock_exams SET variant=?,date=?,items=?,scale_version=? WHERE id=?')
      .run(input.variant, input.date, JSON.stringify(input.items), input.scaleVersion, input.id);
  }
  deleteMockExam(id) {
    return db.prepare('DELETE FROM mock_exams WHERE id=?').run(id);
  }

  inviteCodeExists(code) {
    return !!db.prepare('SELECT id FROM invites WHERE code = ?').get(code);
  }
  findInvite(id) {
    return db.prepare('SELECT * FROM invites WHERE id = ?').get(id) || null;
  }
  createInvite(input) {
    db.prepare(
      `INSERT INTO invites (id,code,kind,tutor_id,subject_id,group_id,student_id,
                created_by,created_at,expires_at,max_uses,used_count,status,note)
                VALUES (?,?,?,?,?,?,NULL,?,?,?,?,0,'active',?)`,
    ).run(
      input.id,
      input.code,
      input.kind,
      input.tutorId,
      input.subjectId,
      input.groupId,
      input.createdBy,
      input.createdAt,
      input.expiresAt,
      input.maxUses,
      input.note,
    );
    return rows.rowInvite(this.findInvite(input.id));
  }
  revokeInvite(invite) {
    return db
      .prepare(
        "UPDATE invites SET status = 'revoked', version = version + 1 WHERE id = ? AND version = ?",
      )
      .run(invite.id, invite.version);
  }
  addEnrollmentFromInvite(input) {
    db.prepare(
      `INSERT INTO enrollments (id,student_id,tutor_id,subject_id,status,started_at,source,invite_id)
                VALUES (?,?,?,?,'active',?, 'invite', ?)`,
    ).run(
      input.id,
      input.studentId,
      input.tutorId,
      input.subjectId,
      input.startedAt,
      input.inviteId,
    );
  }
  addGroupMemberFromInvite(input) {
    db.prepare(
      `INSERT INTO group_members (group_id,student_id,joined_at,status,source,invite_id)
                VALUES (?,?,?, 'active','invite',?)`,
    ).run(input.groupId, input.studentId, input.joinedAt, input.inviteId);
  }
  assignmentsForGroup(groupId) {
    return db.prepare('SELECT * FROM assignments WHERE group_id = ?').all(groupId);
  }
  consumeInvite(invite, usedCount, status) {
    return db
      .prepare(
        `UPDATE invites SET used_count = ?, status = ?, version = version + 1
                       WHERE id = ? AND version = ?`,
      )
      .run(usedCount, status, invite.id, invite.version);
  }

  findOwnedLesson(tutorId, lessonId) {
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    return lesson && lesson.tutor_id === tutorId ? lesson : null;
  }
  studentsOfLesson(lesson) {
    if (lesson.group_id) return this.activeGroupStudentIds(lesson.group_id);
    const enrollment = this.findEnrollment(lesson.enrollment_id);
    return enrollment ? [enrollment.student_id] : [];
  }
  createLesson(input) {
    db.prepare(
      `INSERT INTO lessons (id,subject_id,tutor_id,enrollment_id,group_id,starts_at,duration_min,status,links,task_ids,note,recurrence_id,recurrence_rule)
                VALUES (?,?,?,?,?,?,?, 'planned','[]','[]',NULL,?,?)`,
    ).run(
      input.id,
      input.subjectId,
      input.tutorId,
      input.enrollmentId,
      input.groupId,
      input.startsAt,
      input.durationMin,
      input.recurrenceId || null,
      input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null,
    );
  }
  updateLessonLinks(lesson, links) {
    return db
      .prepare(
        `UPDATE lessons SET links = ?, version = version + 1
                       WHERE id = ? AND version = ?`,
      )
      .run(JSON.stringify(links), lesson.id, lesson.version);
  }
  updateLessonTasks(lesson, taskIds) {
    return db
      .prepare(
        `UPDATE lessons SET task_ids = ?, version = version + 1
                       WHERE id = ? AND version = ?`,
      )
      .run(JSON.stringify(taskIds), lesson.id, lesson.version);
  }
  updateLessonNote(lesson, note) {
    return db
      .prepare(
        `UPDATE lessons SET note = ?, version = version + 1
                       WHERE id = ? AND version = ?`,
      )
      .run(JSON.stringify(note), lesson.id, lesson.version);
  }
  removeIssuedAttempt(lessonId, taskId) {
    db.prepare(
      "DELETE FROM attempts WHERE lesson_id = ? AND task_id = ? AND status = 'issued'",
    ).run(lessonId, taskId);
  }

  ensureAttempt(studentId, taskId, scope, idFactory) {
    const task = this.findTask(taskId);
    if (!task) return null;
    const found = db
      .prepare(
        `SELECT * FROM attempts WHERE student_id = ? AND task_id = ?
      AND IFNULL(assignment_id,'') = IFNULL(?, '') AND IFNULL(lesson_id,'') = IFNULL(?, '')
      AND (? IS NULL OR context = ?) ORDER BY rowid DESC LIMIT 1`,
      )
      .get(
        studentId,
        taskId,
        scope.assignmentId || null,
        scope.lessonId || null,
        scope.context || null,
        scope.context || null,
      );
    if (found && !(scope.newIfClosed && ['checked', 'submitted'].includes(found.status)))
      return found;
    const id = idFactory();
    db.prepare(
      `INSERT INTO attempts (id,task_id,student_id,subject_id,context,lesson_id,assignment_id,group_id,
      code,answer,tries,is_correct,first_try_correct,active_seconds,status)
      VALUES (?,?,?,?,?,?,?,?,'','',0,NULL,NULL,0,'issued')`,
    ).run(
      id,
      taskId,
      studentId,
      task.subject_id,
      scope.context || (scope.lessonId ? 'lesson' : 'homework'),
      scope.lessonId || null,
      scope.assignmentId || null,
      scope.groupId || null,
    );
    return this.findAttempt(id);
  }
  createAssignment(input) {
    db.prepare(
      `INSERT INTO assignments
      (id,subject_id,enrollment_id,group_id,lesson_id,title,due_at,task_ids,status)
      VALUES (?,?,?,?,?,?,?,?,'published')`,
    ).run(
      input.id,
      input.subjectId,
      input.enrollmentId,
      input.groupId,
      input.lessonId,
      input.title,
      input.dueAt,
      JSON.stringify(input.taskIds),
    );
  }

  findAttempt(id) {
    return db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) || null;
  }
  updateAttemptProgress(attempt, input) {
    return db
      .prepare(
        `UPDATE attempts SET code = ?, active_seconds = ?, status = ?,
      started_at = IFNULL(started_at, ?), version = version + 1 WHERE id = ? AND version = ?`,
      )
      .run(
        input.code,
        input.activeSeconds,
        input.status,
        input.startedAt,
        attempt.id,
        attempt.version,
      );
  }
  updateAttemptAnswer(attempt, input) {
    return db
      .prepare(
        `UPDATE attempts SET answer = ?, tries = ?, is_correct = ?, first_try_correct = ?,
      active_seconds = ?, status = ?, started_at = IFNULL(started_at, ?), submitted_at = ?,
      version = version + 1 WHERE id = ? AND version = ?`,
      )
      .run(
        input.answer,
        input.tries,
        input.isCorrect,
        input.firstTryCorrect,
        input.activeSeconds,
        input.status,
        input.startedAt,
        input.submittedAt,
        attempt.id,
        attempt.version,
      );
  }
  submitAttempt(attempt, input) {
    return db
      .prepare(
        `UPDATE attempts SET code = ?, active_seconds = ?, status = ?,
      started_at = IFNULL(started_at, ?), submitted_at = ?, version = version + 1
      WHERE id = ? AND version = ?`,
      )
      .run(
        input.code,
        input.activeSeconds,
        input.status,
        input.startedAt,
        input.submittedAt,
        attempt.id,
        attempt.version,
      );
  }
  tutorOwnsStudent(tutorId, studentId) {
    return !!db
      .prepare(
        `SELECT 1 x FROM enrollments WHERE tutor_id = ? AND student_id = ?
      UNION SELECT 1 x FROM groups g JOIN group_members gm ON gm.group_id = g.id
      WHERE g.tutor_id = ? AND gm.student_id = ?`,
      )
      .get(tutorId, studentId, tutorId, studentId);
  }
  reviewAttempt(attempt, input) {
    return db
      .prepare(
        `UPDATE attempts SET status = 'checked', is_correct = ?, review_score = ?,
      review_comment = ?, reviewed_by = ?, reviewed_at = ?, version = version + 1
      WHERE id = ? AND version = ?`,
      )
      .run(
        input.isCorrect,
        input.score,
        input.comment,
        input.reviewedBy,
        input.reviewedAt,
        attempt.id,
        attempt.version,
      );
  }
  savePreference(userId, channel, enabled) {
    db.prepare(
      `INSERT INTO notification_prefs (user_id,channel,enabled,handle,minutes_before)
      VALUES (?,?,?,'',NULL) ON CONFLICT(user_id,channel)
      DO UPDATE SET enabled = excluded.enabled`,
    ).run(userId, channel, enabled ? 1 : 0);
  }
}

module.exports = { SqlitePlatformRepository };
