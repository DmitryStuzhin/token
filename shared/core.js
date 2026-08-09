/* ═══════════════════════════════════════════════════════════════════
   АГРЕГАТЫ И ВЫБОРКИ — общий код сервера и клиента

   createCore(state) возвращает набор чистых выборок над снимком данных.
   Сервер собирает снимок из БД, клиент получает его же по сети — логика
   одна, расхождений между экраном и API быть не может.

   Мутаций здесь нет: изменять данные вправе только сервер.
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════
   АГРЕГАТЫ И ВЫБОРКИ

   Всё, что показывают экраны, считается здесь из таблиц DB.
   В боевой версии эти функции переезжают на сервер и превращаются
   в TopicMastery / DailyActivity / TaskNumberStats из доменной модели.

   Правило масштабирования: ни одна функция не знает про конкретный
   предмет. Номера заданий, максимумы и шкала перевода берутся из
   subject.exam, поэтому новый предмет — это запись в таблице.
   Почти все выборки принимают необязательный subjectId: без него —
   по всем предметам ученика, с ним — по одному.
   ═══════════════════════════════════════════════════════════════════ */
function createCore(db) {
  const DAY = 86400000;

  /* ── справочные выборки ──────────────────────────────────────── */
  const byId = (arr, id) => arr.find(x => x.id === id) || null;
  const task = id => byId(db.tasks, id);
  const topic = id => byId(db.topics, id);
  const user = id => byId(db.users, id);
  const student = id => byId(db.studentProfiles, id);
  const lesson = id => byId(db.lessons, id);
  const assignment = id => byId(db.assignments, id);
  const attempt = id => byId(db.attempts, id);
  const subject = id => byId(db.subjects, id);
  const group = id => byId(db.groups, id);
  const tutorProfile = id => byId(db.tutorProfiles, id);

  const examOf = sid => (subject(sid) || {}).exam || { parts: [], scale: [0] };
  const partOf = (sid, number) => examOf(sid).parts.find(p => p.number === number) || null;
  const maxPrimary = sid => examOf(sid).parts.reduce((s, p) => s + p.maxPoints, 0);
  const scaled = (sid, primary) => {
    const sc = examOf(sid).scale;
    return sc[Math.max(0, Math.min(sc.length - 1, primary))] || 0;
  };

  const studentUser = sid => user((student(sid) || {}).userId);
  const tutorUser = tpId => user((tutorProfile(tpId) || {}).userId);

  /* ── членство: привязки и группы ─────────────────────────────── */
  const enrollmentsOf = (sid, subjectId) => db.enrollments
    .filter(e => e.studentId === sid && (!subjectId || e.subjectId === subjectId));
  const enrollmentIds = (sid, subjectId) => enrollmentsOf(sid, subjectId).map(e => e.id);

  const groupsOf = (sid, subjectId) => db.groupMembers
    .filter(m => m.studentId === sid && m.status === 'active')
    .map(m => group(m.groupId))
    .filter(g => g && (!subjectId || g.subjectId === subjectId));
  const groupIds = (sid, subjectId) => groupsOf(sid, subjectId).map(g => g.id);

  const membersOf = gid => db.groupMembers
    .filter(m => m.groupId === gid && m.status === 'active')
    .map(m => Object.assign({}, m, { profile: student(m.studentId), user: studentUser(m.studentId) }))
    .filter(m => m.profile);

  const groupsOfTutor = tpId => db.groups.filter(g => g.tutorId === tpId);

  /* предметы, которые ученик реально изучает */
  function subjectsOf(sid) {
    const ids = new Set();
    enrollmentsOf(sid).forEach(e => ids.add(e.subjectId));
    groupsOf(sid).forEach(g => ids.add(g.subjectId));
    return [...ids].map(subject).filter(Boolean);
  }

  /* все ученики репетитора — индивидуальные и групповые */
  function studentsOfTutor(tpId) {
    const ids = new Set(db.enrollments.filter(e => e.tutorId === tpId).map(e => e.studentId));
    groupsOfTutor(tpId).forEach(g => membersOf(g.id).forEach(m => ids.add(m.studentId)));
    return [...ids];
  }

  const tutorOf = (sid, subjectId) => {
    const e = enrollmentsOf(sid, subjectId)[0];
    if (e) return { profile: tutorProfile(e.tutorId), user: tutorUser(e.tutorId), via: 'enrollment' };
    const g = groupsOf(sid, subjectId)[0];
    if (g) return { profile: tutorProfile(g.tutorId), user: tutorUser(g.tutorId), via: 'group' };
    return null;
  };

  const childrenOf = parentUserId => db.guardians
    .filter(g => g.parentUserId === parentUserId && g.status === 'confirmed')
    .map(g => g.studentId);

  /* ── занятия ─────────────────────────────────────────────────── */
  function lessonsOf(sid, subjectId) {
    const eids = enrollmentIds(sid, subjectId);
    const gids = groupIds(sid, subjectId);
    return db.lessons
      .filter(l => (l.enrollmentId && eids.includes(l.enrollmentId)) ||
                   (l.groupId && gids.includes(l.groupId)))
      .filter(l => !subjectId || l.subjectId === subjectId)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }
  function lessonsOfGroup(gid) {
    return db.lessons.filter(l => l.groupId === gid)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }
  function nextLesson(sid, subjectId) {
    const now = Date.now();
    return lessonsOf(sid, subjectId)
      .find(l => l.status === 'planned' && new Date(l.startsAt).getTime() > now - 90 * 60000) || null;
  }
  function lessonIsLive(l) {
    if (!l) return false;
    const s = new Date(l.startsAt).getTime();
    return Date.now() >= s - 10 * 60000 && Date.now() <= s + l.durationMin * 60000;
  }
  function studentsOfLesson(l) {
    if (!l) return [];
    if (l.groupId) return membersOf(l.groupId).map(m => m.studentId);
    const e = byId(db.enrollments, l.enrollmentId);
    return e ? [e.studentId] : [];
  }
  const isGroupLesson = l => !!(l && l.groupId);

  /* статус посещения конкретным учеником */
  function attendanceOf(lessonId, sid) {
    const row = db.lessonAttendance.find(a => a.lessonId === lessonId && a.studentId === sid);
    if (row) return row.status;
    const l = lesson(lessonId);
    if (!l) return null;
    if (l.groupId) return l.status === 'done' ? 'present' : null;   /* нет строки — считаем как проведено */
    return { done:'present', missed:'absent', moved:'moved', planned:null }[l.status] || null;
  }

  /* ── попытки ─────────────────────────────────────────────────── */
  const attemptsOf = (sid, subjectId) => db.attempts
    .filter(a => a.studentId === sid && (!subjectId || a.subjectId === subjectId));
  const attemptsOfAssignment = aid => db.attempts.filter(a => a.assignmentId === aid);
  const attemptsOfLesson = lid => db.attempts.filter(a => a.lessonId === lid);
  const attemptFor = (sid, taskId, scope) => db.attempts.filter(a =>
    a.studentId === sid && a.taskId === taskId &&
    (scope && scope.assignmentId ? a.assignmentId === scope.assignmentId : true) &&
    (scope && scope.lessonId ? a.lessonId === scope.lessonId : true) &&
    (scope && scope.context ? a.context === scope.context : true)).at(-1);

  const attemptDate = a => a.submittedAt || a.startedAt || null;
  const isDone = a => a.status === 'checked' || a.status === 'submitted';
  /* Автопроверка фиксирует ошибку сразу, хотя задача остаётся открытой для
     следующей попытки. Ручная работа становится оценённой только после проверки. */
  const isEvaluated = a => a.isCorrect !== null && (isDone(a) || (a.tries || 0) > 0);

  /* ── домашние задания ────────────────────────────────────────── */
  function assignmentsOf(sid, subjectId) {
    const eids = enrollmentIds(sid, subjectId);
    const gids = groupIds(sid, subjectId);
    return db.assignments
      .filter(a => (a.enrollmentId && eids.includes(a.enrollmentId)) ||
                   (a.groupId && gids.includes(a.groupId)))
      .filter(a => !subjectId || a.subjectId === subjectId)
      .map(a => decorateAssignment(a, sid))
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  }

  /* прогресс считается по конкретному ученику: у группового задания
     у каждого участника свои попытки */
  function decorateAssignment(a, sid) {
    const att = attemptsOfAssignment(a.id).filter(x => !sid || x.studentId === sid);
    const total = a.taskIds.length;
    const done = att.filter(isDone).length;
    const correct = att.filter(x => x.isCorrect === true).length;
    const awaiting = att.some(x => x.status === 'submitted');
    const started = att.some(x => x.status !== 'issued');
    const overdue = Date.now() > new Date(a.dueAt).getTime() && done < total;
    const seconds = att.reduce((s, x) => s + (x.activeSeconds || 0), 0);

    let status = 'issued';
    if (done === total && total > 0 && !awaiting) status = 'checked';
    else if (awaiting) status = 'submitted';
    else if (overdue) status = 'overdue';
    else if (started) status = 'in_progress';

    return Object.assign({}, a, {
      attempts: att, total, done, correct, awaiting, overdue, seconds, status,
      isGroup: !!a.groupId,
      groupTitle: a.groupId ? (group(a.groupId) || {}).title : null,
      score: done ? Math.round((correct / Math.max(done, 1)) * 100) : null,
      daysLeft: Math.ceil((new Date(a.dueAt).getTime() - Date.now()) / DAY),
    });
  }

  const ASSIGNMENT_STATUS = {
    issued:      { label:'выдано',      cls:'b-grey'  },
    in_progress: { label:'в работе',    cls:'b-blue'  },
    submitted:   { label:'на проверке', cls:'b-amber' },
    checked:     { label:'проверено',   cls:'b-green' },
    overdue:     { label:'просрочено',  cls:'b-red'   },
  };

  /* ── автопроверка ────────────────────────────────────────────── */
  function normalize(v, t) {
    const s = String(v == null ? '' : v).trim();
    if (t.compare === 'ci') return s.toLowerCase().replace(/\s+/g, '');
    if (t.compare === 'set') return s.split(/[\s,;]+/).filter(Boolean).sort().join(' ');
    return s.replace(/\s+/g, ' ');
  }
  const num = v => parseFloat(String(v).replace(',', '.').replace(/\s+/g, ''));
  function checkAnswer(t, value) {
    if (!t || !t.autoCheck) return null;                 /* ручная проверка */
    if (t.compare === 'numeric') {
      const a = num(value), b = num(t.answer);
      if (isNaN(a) || isNaN(b)) return false;
      return Math.abs(a - b) <= (t.tolerance || 0);
    }
    return normalize(value, t) === normalize(t.answer, t);
  }

  /* ── активность и серия ──────────────────────────────────────── */
  const dayKey = ts => { const x = new Date(ts); x.setHours(0, 0, 0, 0); return x.getTime(); };

  function dailyActivity(sid, days, subjectId) {
    const map = new Map();
    attemptsOf(sid, subjectId).forEach(a => {
      const dt = attemptDate(a);
      if (!dt || !isEvaluated(a)) return;
      const k = dayKey(dt);
      const cur = map.get(k) || { solved: 0, seconds: 0 };
      cur.solved += 1; cur.seconds += a.activeSeconds || 0;
      map.set(k, cur);
    });
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * DAY);
      const v = map.get(k) || { solved: 0, seconds: 0 };
      out.push({ date: new Date(k), solved: v.solved, seconds: v.seconds });
    }
    return out;
  }

  function streak(sid, subjectId) {
    const days = dailyActivity(sid, 200, subjectId);
    let n = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].solved > 0) n++;
      else if (i === days.length - 1) continue;   /* сегодня ещё может быть пустым */
      else break;
    }
    return n;
  }

  /* ── темы ────────────────────────────────────────────────────── */
  function topicMastery(sid, subjectId) {
    const now = Date.now();
    const acc = new Map();
    attemptsOf(sid, subjectId).forEach(a => {
      if (!isEvaluated(a)) return;
      const t = task(a.taskId); if (!t) return;
      const dt = new Date(attemptDate(a)).getTime();
      const cur = acc.get(t.topicId) || { n:0, ok:0, n30:0, ok30:0, nPrev:0, okPrev:0, seconds:0 };
      cur.n++; cur.seconds += a.activeSeconds || 0;
      if (a.isCorrect) cur.ok++;
      if (now - dt <= 30 * DAY) { cur.n30++; if (a.isCorrect) cur.ok30++; }
      else if (now - dt <= 60 * DAY) { cur.nPrev++; if (a.isCorrect) cur.okPrev++; }
      acc.set(t.topicId, cur);
    });
    return db.topics
      .filter(tp => !subjectId || tp.subjectId === subjectId)
      .map(tp => {
        const c = acc.get(tp.id);
        if (!c || !c.n) return { topic: tp, hasData: false, percent: null, delta: null, n: 0 };
        const p30 = c.n30 ? (c.ok30 / c.n30) * 100 : null;
        const pPrev = c.nPrev ? (c.okPrev / c.nPrev) * 100 : null;
        return {
          topic: tp, hasData: true, percent: Math.round((c.ok / c.n) * 100), n: c.n, seconds: c.seconds,
          delta: (p30 != null && pPrev != null) ? Math.round(p30 - pPrev) : null,
        };
      })
      .filter(x => x.hasData)
      .sort((a, b) => a.percent - b.percent);
  }

  /* ── сводка по номерам заданий (TaskNumberStats) ─────────────── */
  function taskNumberStats(sid, days, subjectId) {
    const from = days ? Date.now() - days * DAY : 0;
    const acc = new Map();
    attemptsOf(sid, subjectId).forEach(a => {
      if (!isEvaluated(a)) return;
      const dt = attemptDate(a); if (!dt || new Date(dt).getTime() < from) return;
      const t = task(a.taskId); if (!t) return;
      const key = t.subjectId + ':' + t.number;
      const cur = acc.get(key) || { n:0, ok:0, first:0, seconds:0, subjectId:t.subjectId, number:t.number };
      cur.n++; cur.seconds += a.activeSeconds || 0;
      if (a.isCorrect) cur.ok++;
      if (a.firstTryCorrect) cur.first++;
      acc.set(key, cur);
    });
    return [...acc.values()].map(c => ({
      subjectId: c.subjectId,
      subject: subject(c.subjectId),
      number: c.number,
      topic: topic((partOf(c.subjectId, c.number) || {}).topicId),
      maxPoints: (partOf(c.subjectId, c.number) || {}).maxPoints || 1,
      attempts: c.n, correct: c.ok,
      percent: Math.round((c.ok / c.n) * 100),
      firstTryPercent: Math.round((c.first / c.n) * 100),
      seconds: c.seconds,
      avgSeconds: Math.round(c.seconds / c.n),
    })).sort((a, b) => a.subjectId.localeCompare(b.subjectId) || a.number - b.number);
  }

  /* ── посещаемость ────────────────────────────────────────────── */
  function attendance(sid, days, subjectId) {
    const from = Date.now() - days * DAY;
    /* занятие учитывается, если оно уже прошло ИЛИ явно закрыто
       репетитором: статус важнее расписания */
    const ls = lessonsOf(sid, subjectId).filter(l => {
      const t = new Date(l.startsAt).getTime();
      if (t < from) return false;
      return t <= Date.now() || l.status !== 'planned';
    });
    const c = { present:0, late:0, absent:0, moved:0 };
    let minutes = 0;
    ls.forEach(l => {
      const st = attendanceOf(l.id, sid);
      if (!st) return;
      c[st] = (c[st] || 0) + 1;
      if (st === 'present' || st === 'late') minutes += l.durationMin;
    });
    const counted = c.present + c.late + c.absent + c.moved;
    const attended = c.present + c.late;
    return Object.assign(c, {
      done: attended, missed: c.absent, total: counted,
      percent: counted ? Math.round((attended / counted) * 100) : null,
      hours: Math.round(minutes / 60),
    });
  }

  /* ── пробники ────────────────────────────────────────────────── */
  function mockSeries(sid, subjectId) {
    return db.mockExams
      .filter(m => m.studentId === sid && (!subjectId || m.subjectId === subjectId))
      .map(m => {
        const primary = m.items.reduce((s, i) => s + i.got, 0);
        return {
          id:m.id, variant:m.variant, subjectId:m.subjectId, date:new Date(m.date),
          primary, primaryMax: maxPrimary(m.subjectId),
          score: scaled(m.subjectId, primary), items: m.items,
        };
      })
      .sort((a, b) => a.date - b.date);
  }

  /* ── цели и KPI ──────────────────────────────────────────────── */
  const goalOf = (sid, subjectId) => db.goals
    .find(g => g.studentId === sid && (!subjectId || g.subjectId === subjectId)) || null;
  const subscriptionOf = sid => db.subscriptions.find(s => s.studentId === sid) || null;

  function goalProgress(sid, subjectId) {
    const g = goalOf(sid, subjectId); if (!g) return null;
    const series = mockSeries(sid, g.subjectId);
    const cur = series.length ? series[series.length - 1].score : null;
    return {
      goal: g, subject: subject(g.subjectId),
      current: cur, target: g.targetScore,
      percent: cur == null ? null : Math.min(100, Math.round((cur / g.targetScore) * 100)),
      left: cur == null ? null : Math.max(0, g.targetScore - cur),
      daysToExam: Math.max(0, Math.ceil((new Date(g.examDate).getTime() - Date.now()) / DAY)),
    };
  }

  function kpi(sid, subjectId) {
    const week = dailyActivity(sid, 7, subjectId);
    const done = attemptsOf(sid, subjectId).filter(isEvaluated);
    const correct = done.filter(a => a.isCorrect).length;
    const asg = assignmentsOf(sid, subjectId);
    const series = mockSeries(sid, subjectId);
    return {
      accuracy: done.length ? Math.round((correct / done.length) * 100) : null,
      solvedWeek: week.reduce((s, d) => s + d.solved, 0),
      secondsWeek: week.reduce((s, d) => s + d.seconds, 0),
      streak: streak(sid, subjectId),
      overdue: asg.filter(a => a.status === 'overdue').length,
      solvedTotal: done.length,
      lastMock: series.length ? series[series.length - 1] : null,
      mockDelta: series.length > 1 ? series[series.length - 1].score - series[series.length - 2].score : null,
      hours: Math.round(attemptsOf(sid, subjectId).reduce((s, a) => s + (a.activeSeconds || 0), 0) / 3600),
    };
  }

  /* ── ближайшие дела ──────────────────────────────────────────── */
  function upcoming(sid, limit, subjectId) {
    const rows = [];
    assignmentsOf(sid, subjectId).forEach(a => {
      if (a.status === 'checked') return;
      rows.push({ kind:'assignment', id:a.id, title:a.title, dueAt:a.dueAt, status:a.status, meta:a });
    });
    subjectsOf(sid).forEach(s => {
      if (subjectId && s.id !== subjectId) return;
      const nl = nextLesson(sid, s.id);
      if (nl) rows.push({ kind:'lesson', id:nl.id, title:'Занятие · ' + s.name, dueAt:nl.startsAt, status:'planned', meta:nl });
    });
    return rows.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, limit || 5);
  }

  /* ── репетитор ───────────────────────────────────────────────── */
  function reviewQueue(tpId) {
    const out = [];
    studentsOfTutor(tpId).forEach(sid => {
      attemptsOf(sid).filter(a => a.status === 'submitted').forEach(a => {
        out.push({ attempt:a, task:task(a.taskId), student:student(sid), user:studentUser(sid),
                   assignment: a.assignmentId ? assignment(a.assignmentId) : null });
      });
    });
    return out.sort((a, b) => new Date(a.attempt.submittedAt) - new Date(b.attempt.submittedAt));
  }

  function tutorToday(tpId) {
    const gids = groupsOfTutor(tpId).map(g => g.id);
    const eids = db.enrollments.filter(e => e.tutorId === tpId).map(e => e.id);
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const t1 = t0.getTime() + DAY;
    return db.lessons
      .filter(l => (l.groupId && gids.includes(l.groupId)) || (l.enrollmentId && eids.includes(l.enrollmentId)))
      .filter(l => { const t = new Date(l.startsAt).getTime(); return t >= t0.getTime() && t < t1; })
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }

  /* агрегат по группе — та же математика, просто по нескольким ученикам */
  function groupStats(gid) {
    const g = group(gid); if (!g) return null;
    const members = membersOf(gid);
    const rows = members.map(m => {
      const k = kpi(m.studentId, g.subjectId);
      const att = attendance(m.studentId, 60, g.subjectId);
      const weak = topicMastery(m.studentId, g.subjectId)[0] || null;
      return { member:m, kpi:k, attendance:att, weak };
    });
    const withAcc = rows.filter(r => r.kpi.accuracy != null);
    const withAtt = rows.filter(r => r.attendance.percent != null);
    return {
      group: g, subject: subject(g.subjectId), members: rows,
      size: members.length, capacity: g.capacity,
      avgAccuracy: withAcc.length ? Math.round(withAcc.reduce((s, r) => s + r.kpi.accuracy, 0) / withAcc.length) : null,
      avgAttendance: withAtt.length ? Math.round(withAtt.reduce((s, r) => s + r.attendance.percent, 0) / withAtt.length) : null,
      solvedWeek: rows.reduce((s, r) => s + r.kpi.solvedWeek, 0),
      overdue: rows.reduce((s, r) => s + r.kpi.overdue, 0),
      lessons: lessonsOfGroup(gid),
      assignments: db.assignments.filter(a => a.groupId === gid),
    };
  }

  /* ── приглашения ─────────────────────────────────────────────────
     Одна таблица на три сценария: индивидуальная привязка, вступление
     в группу, доступ родителя. Приняли ссылку — создаётся Enrollment
     или GroupMember, история сохраняется.
     ──────────────────────────────────────────────────────────────── */
  const inviteByCode = code => db.invites
    .find(i => String(i.code).toUpperCase() === String(code || '').trim().toUpperCase()) || null;

  function inviteState(inv) {
    if (!inv) return { ok:false, reason:'not_found', label:'Ссылка не найдена' };
    if (inv.status === 'revoked') return { ok:false, reason:'revoked', label:'Приглашение отозвано' };
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now())
      return { ok:false, reason:'expired', label:'Срок действия истёк' };
    if (inv.maxUses != null && inv.usedCount >= inv.maxUses)
      return { ok:false, reason:'used_up', label:'Лимит переходов исчерпан' };
    if (inv.kind === 'group') {
      const g = group(inv.groupId);
      if (!g) return { ok:false, reason:'no_group', label:'Группа не найдена' };
      if (membersOf(g.id).length >= g.capacity)
        return { ok:false, reason:'full', label:'В группе нет свободных мест' };
    }
    return { ok:true, reason:'active', label:'Приглашение действительно' };
  }

  function inviteTarget(inv) {
    if (!inv) return null;
    return {
      kind: inv.kind,
      subject: inv.subjectId ? subject(inv.subjectId) : null,
      tutor: inv.tutorId ? { profile: tutorProfile(inv.tutorId), user: tutorUser(inv.tutorId) } : null,
      group: inv.groupId ? group(inv.groupId) : null,
      student: inv.studentId ? { profile: student(inv.studentId), user: studentUser(inv.studentId) } : null,
      seatsLeft: inv.maxUses == null ? null : Math.max(0, inv.maxUses - inv.usedCount),
    };
  }

  /* уже состоит? второй раз присоединяться незачем */
  function inviteAlreadyJoined(inv, sid) {
    if (!inv) return false;
    if (inv.kind === 'group') return groupIds(sid).includes(inv.groupId);
    if (inv.kind === 'enrollment')
      return enrollmentsOf(sid, inv.subjectId).some(e => e.tutorId === inv.tutorId && e.status === 'active');
    if (inv.kind === 'guardian') return true;
    return false;
  }

  const invitesOfTutor = tpId => db.invites.filter(i => i.tutorId === tpId);
  const inviteUrl = code => {
    const origin = (typeof location !== 'undefined' && location.origin) || '';
    return origin + '/invite.html?code=' + encodeURIComponent(code);
  };

  /* ── форматирование ──────────────────────────────────────────── */
  const RU = 'ru-RU';
  const pad = n => String(n).padStart(2, '0');
  const fmtTime = ts => { const x = new Date(ts); return pad(x.getHours()) + ':' + pad(x.getMinutes()); };
  const fmtDate = ts => new Date(ts).toLocaleDateString(RU, { day:'numeric', month:'short' });
  const fmtDateFull = ts => new Date(ts).toLocaleDateString(RU, { weekday:'long', day:'numeric', month:'long' });
  const fmtDateTime = ts => fmtDate(ts) + ', ' + fmtTime(ts);

  function relDay(ts) {
    const diff = Math.round((dayKey(ts) - dayKey(Date.now())) / DAY);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff === -1) return 'вчера';
    return null;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function splitDur(sec) {
    const t = Math.max(0, Math.round(sec || 0));
    return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60) };
  }
  function fmtDur(sec) {
    const { h, m } = splitDur(sec);
    if (!h && !m) return sec ? 'меньше минуты' : '0 мин';
    if (h && m) return h + ' ч ' + m + ' мин';
    if (h) return h + ' ' + plural(h, 'час', 'часа', 'часов');
    return m + ' мин';
  }
  function fmtDurShort(sec) {
    if (!sec) return '—';
    const { h, m } = splitDur(sec);
    return h ? h + ' ч ' + pad(m) : m + ' мин';
  }
  const fmtMoney = n => new Intl.NumberFormat(RU).format(n) + ' ₽';

  return {
    db, DAY,
    task, topic, user, student, lesson, assignment, attempt, subject, group, tutorProfile,
    examOf, partOf, maxPrimary, scaled,
    studentUser, tutorUser, enrollmentsOf, groupsOf, membersOf, groupsOfTutor,
    subjectsOf, studentsOfTutor, tutorOf, childrenOf, goalOf, subscriptionOf,
    lessonsOf, lessonsOfGroup, nextLesson, lessonIsLive, studentsOfLesson, isGroupLesson, attendanceOf,
    attemptsOf, attemptsOfAssignment, attemptsOfLesson, attemptFor, attemptDate, isDone, isEvaluated,
    assignmentsOf, decorateAssignment, ASSIGNMENT_STATUS,
    checkAnswer, dailyActivity, streak, topicMastery, taskNumberStats,
    attendance, mockSeries, kpi, goalProgress, upcoming, reviewQueue, tutorToday, groupStats,
    inviteByCode, inviteState, inviteTarget, inviteAlreadyJoined, invitesOfTutor, inviteUrl,
    fmtTime, fmtDate, fmtDateFull, fmtDateTime, relDay, plural, fmtDur, fmtDurShort, fmtMoney,
  };
}

if (typeof module === 'object' && module.exports) module.exports = { createCore };
else if (typeof window !== 'undefined') window.createCore = createCore;
