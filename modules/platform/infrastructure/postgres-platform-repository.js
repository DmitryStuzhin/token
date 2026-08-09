const { AsyncLocalStorage } = require('node:async_hooks');
const { v7: uuidv7 } = require('uuid');

const parseJson = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const external = (row) => (row ? row.legacy_id || String(row.id) : null);

class PostgresPlatformRepository {
  constructor(pool) {
    this.pool = pool;
    this.transactions = new AsyncLocalStorage();
  }

  query(sql, parameters = []) {
    return (this.transactions.getStore() || this.pool).query(sql, parameters);
  }

  async transaction(work) {
    const existing = this.transactions.getStore();
    if (existing) return work();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.transactions.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(table, value, codeColumn = null) {
    if (value == null || value === '') return null;
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error('Unsafe table identifier');
    const predicate = codeColumn
      ? `id::text=$1 OR ${codeColumn}=$1`
      : 'id::text=$1 OR legacy_id=$1';
    const result = await this.query(`SELECT id::text FROM ${table} WHERE ${predicate} LIMIT 1`, [
      String(value),
    ]);
    return result.rows[0]?.id || null;
  }

  async readState(withAnswers = true) {
    const names = [
      'users',
      'student_profiles',
      'tutor_profiles',
      'tutor_subjects',
      'subjects',
      'topics',
      'tasks',
      'enrollments',
      'groups',
      'group_members',
      'invites',
      'lessons',
      'lesson_links',
      'lesson_tasks',
      'lesson_attendance',
      'assignments',
      'assignment_tasks',
      'attempts',
      'attempt_reviews',
      'goals',
      'subscriptions',
      'notification_prefs',
      'mock_exams',
    ];
    const results = await Promise.all(names.map((name) => this.query(`SELECT * FROM ${name}`)));
    const data = Object.fromEntries(names.map((name, index) => [name, results[index].rows]));
    const map = (rows) => new Map(rows.map((row) => [String(row.id), external(row)]));
    const userIds = map(data.users);
    const studentIds = map(data.student_profiles);
    const tutorIds = map(data.tutor_profiles);
    const subjectIds = new Map(data.subjects.map((row) => [String(row.id), row.code]));
    const topicIds = map(data.topics);
    const taskIds = map(data.tasks);
    const enrollmentIds = map(data.enrollments);
    const groupIds = map(data.groups);
    const inviteIds = map(data.invites);
    const lessonIds = map(data.lessons);
    const assignmentIds = map(data.assignments);

    const lessonLinks = new Map();
    for (const row of data.lesson_links) {
      const key = String(row.lesson_id);
      const list = lessonLinks.get(key) || [];
      list.push({ type: row.type, label: row.label, url: row.url, position: row.position });
      lessonLinks.set(key, list);
    }
    const lessonTasks = new Map();
    for (const row of data.lesson_tasks) {
      const key = String(row.lesson_id);
      const list = lessonTasks.get(key) || [];
      list.push({ id: taskIds.get(String(row.task_id)), position: row.position });
      lessonTasks.set(key, list);
    }
    const assignmentTasks = new Map();
    for (const row of data.assignment_tasks) {
      const key = String(row.assignment_id);
      const list = assignmentTasks.get(key) || [];
      list.push({ id: taskIds.get(String(row.task_id)), position: row.position });
      assignmentTasks.set(key, list);
    }
    const tutorSubjects = new Map();
    for (const row of data.tutor_subjects) {
      const key = String(row.tutor_id);
      const list = tutorSubjects.get(key) || [];
      list.push(subjectIds.get(String(row.subject_id)));
      tutorSubjects.set(key, list);
    }
    const latestReviews = new Map();
    for (const row of [...data.attempt_reviews].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    )) {
      latestReviews.set(String(row.attempt_id), row);
    }

    const tasks = data.tasks.map((row) => ({
      id: external(row),
      subjectId: subjectIds.get(String(row.subject_id)),
      number: row.number,
      topicId: topicIds.get(String(row.topic_id)) || null,
      title: row.title,
      statement: row.statement,
      answerType: row.answer_type,
      compare: row.compare_mode,
      tolerance: Number(row.tolerance),
      autoCheck: !!row.auto_check,
      difficulty: row.difficulty,
      source: row.source,
      publishedAt: row.created_at,
      taskType: row.task_type || 'answer',
      attachments: parseJson(row.attachments, []),
      ...(withAnswers ? { answer: row.answer } : {}),
    }));
    return {
      subjects: data.subjects.map((row) => ({
        id: row.code,
        name: row.name,
        short: row.short_name,
        slug: row.slug,
        color: row.color,
        exam: parseJson(row.exam, {}),
      })),
      topics: data.topics.map((row) => ({
        id: external(row),
        subjectId: subjectIds.get(String(row.subject_id)),
        name: row.name,
      })),
      tasks,
      users: data.users.map((row) => ({
        id: external(row),
        role: row.role,
        name: row.name,
        email: row.email,
        phone: row.phone,
        tz: row.tz,
        createdAt: row.created_at,
      })),
      studentProfiles: data.student_profiles.map((row) => ({
        id: external(row),
        userId: userIds.get(String(row.user_id)),
        grade: row.grade,
        school: row.school,
        startedAt: row.started_at,
      })),
      tutorProfiles: data.tutor_profiles.map((row) => ({
        id: external(row),
        userId: userIds.get(String(row.user_id)),
        subjects: tutorSubjects.get(String(row.id)) || [],
        yearsExp: row.years_exp,
        rate: Number(row.rate_minor) / 100,
        meetingUrl: row.meeting_url,
      })),
      guardians: [],
      enrollments: data.enrollments.map((row) => ({
        id: external(row),
        studentId: studentIds.get(String(row.student_id)),
        tutorId: tutorIds.get(String(row.tutor_id)),
        subjectId: subjectIds.get(String(row.subject_id)),
        status: row.status,
        startedAt: row.started_at,
        source: row.source,
        inviteId: inviteIds.get(String(row.invite_id)) || null,
      })),
      groups: data.groups.map((row) => ({
        id: external(row),
        tutorId: tutorIds.get(String(row.tutor_id)),
        subjectId: subjectIds.get(String(row.subject_id)),
        title: row.title,
        level: row.level,
        schedule: row.schedule,
        capacity: row.capacity,
        status: row.status,
        createdAt: row.created_at,
      })),
      groupMembers: data.group_members.map((row) => ({
        groupId: groupIds.get(String(row.group_id)),
        studentId: studentIds.get(String(row.student_id)),
        joinedAt: row.joined_at,
        status: row.status,
        source: row.source,
        inviteId: inviteIds.get(String(row.invite_id)) || null,
      })),
      invites: data.invites.map((row) => ({
        id: external(row),
        code: row.code,
        kind: row.kind,
        tutorId: tutorIds.get(String(row.tutor_id)) || null,
        subjectId: subjectIds.get(String(row.subject_id)) || null,
        groupId: groupIds.get(String(row.group_id)) || null,
        studentId: studentIds.get(String(row.student_id)) || null,
        createdBy: userIds.get(String(row.created_by)) || null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        usedCount: row.used_count,
        status: row.status,
        note: row.note,
        version: row.version,
      })),
      goals: data.goals.map((row) => ({
        studentId: studentIds.get(String(row.student_id)),
        subjectId: subjectIds.get(String(row.subject_id)),
        targetScore: row.target_score,
        examDate: row.exam_date,
      })),
      subscriptions: data.subscriptions.map((row) => ({
        id: external(row),
        studentId: studentIds.get(String(row.student_id)),
        payerUserId: userIds.get(String(row.payer_user_id)) || null,
        plan: row.plan,
        lessonsLeft: row.lessons_left,
        lessonsTotal: row.lessons_total,
        price: Number(row.price_minor) / 100,
        nextChargeAt: row.next_charge_at,
        status: row.status,
      })),
      notificationPrefs: data.notification_prefs.map((row) => ({
        userId: userIds.get(String(row.user_id)),
        channel: row.channel,
        enabled: !!row.enabled,
        handle: row.handle,
        minutesBefore: row.minutes_before,
      })),
      lessons: data.lessons.map((row) => ({
        id: external(row),
        subjectId: subjectIds.get(String(row.subject_id)),
        tutorId: tutorIds.get(String(row.tutor_id)),
        enrollmentId: enrollmentIds.get(String(row.enrollment_id)) || null,
        groupId: groupIds.get(String(row.group_id)) || null,
        startsAt: row.starts_at,
        durationMin: row.duration_min,
        status: row.status,
        links: (lessonLinks.get(String(row.id)) || [])
          .sort((a, b) => a.position - b.position)
          .map(({ position, ...link }) => link),
        taskIds: (lessonTasks.get(String(row.id)) || [])
          .sort((a, b) => a.position - b.position)
          .map((item) => item.id),
        note: null,
        version: row.version,
      })),
      lessonAttendance: data.lesson_attendance.map((row) => ({
        lessonId: lessonIds.get(String(row.lesson_id)),
        studentId: studentIds.get(String(row.student_id)),
        status: row.status,
      })),
      assignments: data.assignments.map((row) => ({
        id: external(row),
        subjectId: subjectIds.get(String(row.subject_id)),
        enrollmentId: enrollmentIds.get(String(row.enrollment_id)) || null,
        groupId: groupIds.get(String(row.group_id)) || null,
        lessonId: lessonIds.get(String(row.lesson_id)) || null,
        title: row.title,
        dueAt: row.due_at,
        taskIds: (assignmentTasks.get(String(row.id)) || [])
          .sort((a, b) => a.position - b.position)
          .map((item) => item.id),
        status: row.status,
        version: row.version,
      })),
      mockExams: data.mock_exams.map((row) => ({
        id: external(row),
        studentId: studentIds.get(String(row.student_id)),
        subjectId: subjectIds.get(String(row.subject_id)),
        variant: row.variant,
        date: row.taken_at,
        items: parseJson(row.items, []),
      })),
      attempts: data.attempts.map((row) => {
        const review = latestReviews.get(String(row.id));
        return {
          id: external(row),
          taskId: taskIds.get(String(row.task_id)),
          studentId: studentIds.get(String(row.student_id)),
          subjectId: subjectIds.get(String(row.subject_id)),
          context: row.context,
          lessonId: lessonIds.get(String(row.lesson_id)) || null,
          assignmentId: assignmentIds.get(String(row.assignment_id)) || null,
          groupId: groupIds.get(String(row.group_id)) || null,
          code: row.code || '',
          answer: row.answer || '',
          tries: row.tries || 0,
          isCorrect: row.is_correct,
          firstTryCorrect: row.first_try_correct,
          activeSeconds: row.active_seconds || 0,
          status: row.status,
          startedAt: row.started_at,
          submittedAt: row.submitted_at,
          reviewScore: review?.score ?? null,
          reviewComment: review?.comment ?? null,
          reviewedAt: review?.created_at ?? null,
          version: row.version,
        };
      }),
      me: null,
    };
  }

  async fullState() {
    return this.readState(true);
  }
  async publicTasks() {
    return (await this.readState(false)).tasks;
  }
  async taskWithAnswer(id) {
    return (await this.readState(true)).tasks.find((task) => task.id === id) || null;
  }

  async snapshot(user) {
    const state = await this.readState(false);
    const base = {
      ...state,
      users: [],
      studentProfiles: [],
      tutorProfiles: [],
      enrollments: [],
      groups: [],
      groupMembers: [],
      invites: [],
      goals: [],
      subscriptions: [],
      notificationPrefs: [],
      lessons: [],
      lessonAttendance: [],
      assignments: [],
      mockExams: [],
      attempts: [],
      me: null,
    };
    if (!user) return base;
    base.me = state.users.find((item) => item.id === user.id) || null;
    const studentIds = new Set();
    const tutorIds = new Set();
    if (user.role === 'student') {
      const profile = state.studentProfiles.find((item) => item.userId === user.id);
      if (profile) studentIds.add(profile.id);
    } else if (user.role === 'tutor') {
      const profile = state.tutorProfiles.find((item) => item.userId === user.id);
      if (profile) {
        tutorIds.add(profile.id);
        state.enrollments
          .filter((item) => item.tutorId === profile.id)
          .forEach((item) => studentIds.add(item.studentId));
        const groupSet = new Set(
          state.groups.filter((item) => item.tutorId === profile.id).map((item) => item.id),
        );
        state.groupMembers
          .filter((item) => groupSet.has(item.groupId))
          .forEach((item) => studentIds.add(item.studentId));
      }
    }
    base.studentProfiles = state.studentProfiles.filter((item) => studentIds.has(item.id));
    if (user.role === 'tutor')
      base.tutorProfiles = state.tutorProfiles.filter((item) => item.userId === user.id);
    else {
      const linked = new Set(
        state.enrollments
          .filter((item) => studentIds.has(item.studentId))
          .map((item) => item.tutorId),
      );
      const memberGroups = new Set(
        state.groupMembers
          .filter((item) => studentIds.has(item.studentId))
          .map((item) => item.groupId),
      );
      state.groups
        .filter((item) => memberGroups.has(item.id))
        .forEach((item) => linked.add(item.tutorId));
      base.tutorProfiles = state.tutorProfiles.filter((item) => linked.has(item.id));
      linked.forEach((item) => tutorIds.add(item));
    }
    const visibleUsers = new Set([
      user.id,
      ...base.studentProfiles.map((item) => item.userId),
      ...base.tutorProfiles.map((item) => item.userId),
    ]);
    base.users = state.users.filter((item) => visibleUsers.has(item.id));
    base.enrollments = state.enrollments.filter((item) => studentIds.has(item.studentId));
    base.groupMembers = state.groupMembers.filter((item) => studentIds.has(item.studentId));
    base.goals = state.goals.filter((item) => studentIds.has(item.studentId));
    base.subscriptions = state.subscriptions.filter((item) => studentIds.has(item.studentId));
    base.mockExams = state.mockExams.filter((item) => studentIds.has(item.studentId));
    base.attempts = state.attempts.filter((item) => studentIds.has(item.studentId));
    const memberGroupIds = new Set(base.groupMembers.map((item) => item.groupId));
    base.groups = state.groups.filter(
      (item) => tutorIds.has(item.tutorId) || memberGroupIds.has(item.id),
    );
    if (user.role === 'tutor')
      base.invites = state.invites.filter((item) => tutorIds.has(item.tutorId));
    const enrollmentSet = new Set(base.enrollments.map((item) => item.id));
    const groupSet = new Set(base.groups.map((item) => item.id));
    base.lessons = state.lessons.filter(
      (item) => enrollmentSet.has(item.enrollmentId) || groupSet.has(item.groupId),
    );
    base.assignments = state.assignments.filter(
      (item) => enrollmentSet.has(item.enrollmentId) || groupSet.has(item.groupId),
    );
    const lessonSet = new Set(base.lessons.map((item) => item.id));
    base.lessonAttendance = state.lessonAttendance.filter((item) => lessonSet.has(item.lessonId));
    base.notificationPrefs =
      user.role === 'tutor'
        ? []
        : state.notificationPrefs.filter((item) => item.userId === user.id);
    return base;
  }

  async findTask(id) {
    const task = await this.taskWithAnswer(id);
    return task ? { ...task, subject_id: task.subjectId } : null;
  }
  async taskExists(id) {
    return !!(await this.resolve('tasks', id));
  }
  async subjectExists(id) {
    return !!(await this.resolve('subjects', id, 'code'));
  }
  async insertTasks(items, partOf) {
    const resourceColumn = await this.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_name='tasks' AND column_name='task_type') present`,
    );
    const supportsResources = !!resourceColumn.rows[0]?.present;
    for (const task of items) {
      const subjectId = await this.resolve('subjects', task.subjectId, 'code');
      const part = partOf(task.subjectId, Number(task.number)) || {};
      const topicId = await this.resolve('topics', task.topicId || part.topicId);
      const answer = task.answer == null ? '' : String(task.answer);
      const baseValues = [
        uuidv7(),
        String(task.id),
        subjectId,
        Number(task.number),
        topicId,
        String(task.title),
        String(task.statement),
        answer,
        task.answerType || 'string',
        task.compare || 'exact',
        task.tolerance || 0,
        task.autoCheck != null ? !!task.autoCheck : !!answer.trim(),
        task.difficulty || 2,
        task.source || 'import',
      ];
      await this.query(
        supportsResources
          ? `INSERT INTO tasks (id,legacy_id,subject_id,number,topic_id,title,statement,answer,
        answer_type,compare_mode,tolerance,auto_check,difficulty,source,task_type,attachments)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`
          : `INSERT INTO tasks (id,legacy_id,subject_id,number,topic_id,title,statement,answer,
        answer_type,compare_mode,tolerance,auto_check,difficulty,source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        supportsResources
          ? [...baseValues, task.taskType || 'answer', JSON.stringify(task.attachments || [])]
          : baseValues,
      );
    }
  }

  async findGroup(id) {
    const state = await this.readState(false);
    const group = state.groups.find((item) => item.id === id);
    return group ? { ...group, tutor_id: group.tutorId, subject_id: group.subjectId } : null;
  }
  async findEnrollment(id) {
    const state = await this.readState(false);
    const item = state.enrollments.find((value) => value.id === id);
    return item
      ? { ...item, tutor_id: item.tutorId, subject_id: item.subjectId, student_id: item.studentId }
      : null;
  }
  async activeGroupStudentIds(groupId) {
    const id = await this.resolve('groups', groupId);
    const result = await this.query(
      `SELECT COALESCE(sp.legacy_id,sp.id::text) student_id FROM group_members gm
      JOIN student_profiles sp ON sp.id=gm.student_id WHERE gm.group_id=$1 AND gm.status='active'`,
      [id],
    );
    return result.rows.map((row) => row.student_id);
  }
  async createGroup(input) {
    const tutorId = await this.resolve('tutor_profiles', input.tutorId);
    const subjectId = await this.resolve('subjects', input.subjectId, 'code');
    await this.query(
      `INSERT INTO groups (id,tutor_id,subject_id,title,level,schedule,capacity,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'recruiting')`,
      [input.id, tutorId, subjectId, input.title, input.level, input.schedule, input.capacity],
    );
  }

  async inviteCodeExists(code) {
    return (await this.query('SELECT 1 FROM invites WHERE code=$1', [code])).rowCount > 0;
  }
  async findInvite(id) {
    const state = await this.readState(false);
    const item = state.invites.find((value) => value.id === id);
    if (!item) return null;
    return {
      ...item,
      tutor_id: item.tutorId,
      subject_id: item.subjectId,
      group_id: item.groupId,
      student_id: item.studentId,
      max_uses: item.maxUses,
      used_count: item.usedCount,
    };
  }
  async createInvite(input) {
    const tutorId = await this.resolve('tutor_profiles', input.tutorId);
    const subjectId = await this.resolve('subjects', input.subjectId, 'code');
    const groupId = await this.resolve('groups', input.groupId);
    const createdBy = await this.resolve('users', input.createdBy);
    await this.query(
      `INSERT INTO invites (id,code,kind,tutor_id,subject_id,group_id,created_by,
      expires_at,max_uses,used_count,status,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'active',$10)`,
      [
        input.id,
        input.code,
        input.kind,
        tutorId,
        subjectId,
        groupId,
        createdBy,
        input.expiresAt,
        input.maxUses,
        input.note,
      ],
    );
    return (await this.fullState()).invites.find((item) => item.id === input.id);
  }
  async revokeInvite(invite) {
    return this.optimistic('invites', invite, { status: 'revoked' });
  }
  async addEnrollmentFromInvite(input) {
    await this.query(
      `INSERT INTO enrollments (id,student_id,tutor_id,subject_id,status,started_at,source,invite_id)
      VALUES ($1,$2,$3,$4,'active',$5,'invite',$6)`,
      [
        input.id,
        await this.resolve('student_profiles', input.studentId),
        await this.resolve('tutor_profiles', input.tutorId),
        await this.resolve('subjects', input.subjectId, 'code'),
        input.startedAt,
        await this.resolve('invites', input.inviteId),
      ],
    );
  }
  async addGroupMemberFromInvite(input) {
    await this.query(
      `INSERT INTO group_members (group_id,student_id,joined_at,status,source,invite_id)
      VALUES ($1,$2,$3,'active','invite',$4)`,
      [
        await this.resolve('groups', input.groupId),
        await this.resolve('student_profiles', input.studentId),
        input.joinedAt,
        await this.resolve('invites', input.inviteId),
      ],
    );
  }
  async assignmentsForGroup(groupId) {
    const state = await this.fullState();
    return state.assignments
      .filter((item) => item.groupId === groupId)
      .map((item) => ({ ...item, task_ids: JSON.stringify(item.taskIds) }));
  }
  async consumeInvite(invite, usedCount, status) {
    return this.optimistic('invites', invite, { used_count: usedCount, status });
  }

  async findOwnedLesson(tutorId, lessonId) {
    const state = await this.fullState();
    const lesson = state.lessons.find((item) => item.id === lessonId && item.tutorId === tutorId);
    return lesson
      ? {
          ...lesson,
          tutor_id: lesson.tutorId,
          subject_id: lesson.subjectId,
          enrollment_id: lesson.enrollmentId,
          group_id: lesson.groupId,
          links: JSON.stringify(lesson.links),
          task_ids: JSON.stringify(lesson.taskIds),
        }
      : null;
  }
  async studentsOfLesson(lesson) {
    if (lesson.group_id) return this.activeGroupStudentIds(lesson.group_id);
    const enrollment = await this.findEnrollment(lesson.enrollment_id);
    return enrollment ? [enrollment.student_id] : [];
  }
  async createLesson(input) {
    await this.query(
      `INSERT INTO lessons (id,subject_id,tutor_id,enrollment_id,group_id,starts_at,duration_min,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'planned')`,
      [
        input.id,
        await this.resolve('subjects', input.subjectId, 'code'),
        await this.resolve('tutor_profiles', input.tutorId),
        await this.resolve('enrollments', input.enrollmentId),
        await this.resolve('groups', input.groupId),
        input.startsAt,
        input.durationMin,
      ],
    );
  }
  async updateLessonLinks(lesson, links) {
    const id = await this.resolve('lessons', lesson.id);
    const result = await this.query(
      `UPDATE lessons SET version=version+1,updated_at=now()
      WHERE id=$1 AND version=$2`,
      [id, lesson.version],
    );
    if (result.rowCount !== 1) return result;
    await this.query('DELETE FROM lesson_links WHERE lesson_id=$1', [id]);
    for (let position = 0; position < links.length; position += 1) {
      const link = links[position];
      await this.query(
        `INSERT INTO lesson_links (id,lesson_id,position,type,label,url)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv7(), id, position, link.type, link.label, link.url],
      );
    }
    return result;
  }
  async updateLessonTasks(lesson, taskIds) {
    const id = await this.resolve('lessons', lesson.id);
    const result = await this.query(
      `UPDATE lessons SET version=version+1,updated_at=now()
      WHERE id=$1 AND version=$2`,
      [id, lesson.version],
    );
    if (result.rowCount !== 1) return result;
    await this.query('DELETE FROM lesson_tasks WHERE lesson_id=$1', [id]);
    for (let position = 0; position < taskIds.length; position += 1) {
      await this.query(`INSERT INTO lesson_tasks (lesson_id,task_id,position) VALUES ($1,$2,$3)`, [
        id,
        await this.resolve('tasks', taskIds[position]),
        position,
      ]);
    }
    return result;
  }
  async removeIssuedAttempt(lessonId, taskId) {
    await this.query(`DELETE FROM attempts WHERE lesson_id=$1 AND task_id=$2 AND status='issued'`, [
      await this.resolve('lessons', lessonId),
      await this.resolve('tasks', taskId),
    ]);
  }

  async ensureAttempt(studentId, taskId, scope, idFactory) {
    const student = await this.resolve('student_profiles', studentId);
    const task = await this.resolve('tasks', taskId);
    const lesson = await this.resolve('lessons', scope.lessonId);
    const assignment = await this.resolve('assignments', scope.assignmentId);
    const found = await this.query(
      `SELECT COALESCE(legacy_id,id::text) id FROM attempts
      WHERE student_id=$1 AND task_id=$2 AND assignment_id IS NOT DISTINCT FROM $3::uuid
      AND lesson_id IS NOT DISTINCT FROM $4::uuid AND ($5::text IS NULL OR context=$5)
      ORDER BY created_at DESC LIMIT 1`,
      [student, task, assignment, lesson, scope.context || null],
    );
    if (found.rows[0]) {
      const existing = await this.findAttempt(found.rows[0].id);
      if (!(scope.newIfClosed && ['checked', 'submitted'].includes(existing.status)))
        return existing;
    }
    const subject = await this.query('SELECT subject_id::text FROM tasks WHERE id=$1', [task]);
    const id = idFactory();
    await this.query(
      `INSERT INTO attempts (id,task_id,student_id,subject_id,context,lesson_id,assignment_id,group_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued')`,
      [
        id,
        task,
        student,
        subject.rows[0].subject_id,
        scope.context || (lesson ? 'lesson' : 'homework'),
        lesson,
        assignment,
        await this.resolve('groups', scope.groupId),
      ],
    );
    return this.findAttempt(id);
  }
  async createAssignment(input) {
    const assignmentId = input.id;
    await this.query(
      `INSERT INTO assignments (id,subject_id,enrollment_id,group_id,lesson_id,title,due_at,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        assignmentId,
        await this.resolve('subjects', input.subjectId, 'code'),
        await this.resolve('enrollments', input.enrollmentId),
        await this.resolve('groups', input.groupId),
        await this.resolve('lessons', input.lessonId),
        input.title,
        input.dueAt,
        input.status || 'published',
      ],
    );
    for (let position = 0; position < input.taskIds.length; position += 1) {
      await this.query(
        `INSERT INTO assignment_tasks (assignment_id,task_id,position) VALUES ($1,$2,$3)`,
        [assignmentId, await this.resolve('tasks', input.taskIds[position]), position],
      );
    }
  }

  async findAttempt(id) {
    const state = await this.fullState();
    const item = state.attempts.find((value) => value.id === id);
    return item
      ? {
          ...item,
          student_id: item.studentId,
          task_id: item.taskId,
          lesson_id: item.lessonId,
          assignment_id: item.assignmentId,
          group_id: item.groupId,
          active_seconds: item.activeSeconds,
          submitted_at: item.submittedAt,
        }
      : null;
  }
  async optimistic(table, entity, changes) {
    const id = await this.resolve(table, entity.id);
    const entries = Object.entries(changes);
    const sets = entries.map(([key], index) => `${key}=$${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, entity.version);
    return this.query(
      `UPDATE ${table} SET ${sets.join(',')},version=version+1,updated_at=now()
      WHERE id=$${values.length - 1} AND version=$${values.length}`,
      values,
    );
  }
  async updateAttemptProgress(attempt, input) {
    return this.updateAttemptWithHistory(attempt, {
      code: input.code,
      active_seconds: input.activeSeconds,
      status: input.status,
      started_at: input.startedAt,
    });
  }
  async updateAttemptAnswer(attempt, input) {
    return this.updateAttemptWithHistory(attempt, {
      answer: input.answer,
      tries: input.tries,
      is_correct: !!input.isCorrect,
      first_try_correct: !!input.firstTryCorrect,
      active_seconds: input.activeSeconds,
      status: input.status,
      started_at: input.startedAt,
      submitted_at: input.submittedAt,
    });
  }
  async submitAttempt(attempt, input) {
    return this.updateAttemptWithHistory(attempt, {
      code: input.code,
      active_seconds: input.activeSeconds,
      status: input.status,
      started_at: input.startedAt,
      submitted_at: input.submittedAt,
    });
  }
  async updateAttemptWithHistory(attempt, changes, changedBy = null) {
    return this.transaction(async () => {
      const result = await this.optimistic('attempts', attempt, changes);
      if (result.rowCount === 1) {
        await this.query(
          `INSERT INTO attempt_history
          (id,attempt_id,from_status,to_status,changed_by,snapshot)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            uuidv7(),
            await this.resolve('attempts', attempt.id),
            attempt.status,
            changes.status || attempt.status,
            changedBy,
            JSON.stringify(changes),
          ],
        );
      }
      return result;
    });
  }
  async tutorOwnsStudent(tutorId, studentId) {
    const result = await this.query(
      `SELECT 1 FROM enrollments WHERE tutor_id=$1 AND student_id=$2
      UNION SELECT 1 FROM groups g JOIN group_members gm ON gm.group_id=g.id
      WHERE g.tutor_id=$1 AND gm.student_id=$2 LIMIT 1`,
      [
        await this.resolve('tutor_profiles', tutorId),
        await this.resolve('student_profiles', studentId),
      ],
    );
    return result.rowCount > 0;
  }
  async reviewAttempt(attempt, input) {
    return this.transaction(async () => {
      const reviewer = await this.resolve('tutor_profiles', input.reviewedBy);
      const reviewerUser =
        (await this.query('SELECT user_id::text FROM tutor_profiles WHERE id=$1', [reviewer]))
          .rows[0]?.user_id || null;
      const result = await this.updateAttemptWithHistory(
        attempt,
        { status: 'checked', is_correct: !!input.isCorrect },
        reviewerUser,
      );
      if (result.rowCount === 1) {
        await this.query(
          `INSERT INTO attempt_reviews (id,attempt_id,reviewer_tutor_id,score,comment,decision,created_at)
          VALUES ($1,$2,$3,$4,$5,'checked',$6)`,
          [
            uuidv7(),
            await this.resolve('attempts', attempt.id),
            reviewer,
            input.score,
            input.comment,
            input.reviewedAt,
          ],
        );
      }
      return result;
    });
  }
  async savePreference(userId, channel, enabled) {
    await this.query(
      `INSERT INTO notification_prefs (user_id,channel,enabled) VALUES ($1,$2,$3)
      ON CONFLICT (user_id,channel) DO UPDATE SET enabled=excluded.enabled,
      updated_at=now(),version=notification_prefs.version+1`,
      [await this.resolve('users', userId), channel, enabled],
    );
  }
}

module.exports = { PostgresPlatformRepository };
