/* ═══════════════════════════════════════════════════════════════════
   АГРЕГАТЫ И ВЫБОРКИ

   Всё, что показывают экраны, считается здесь из таблиц DB.
   В боевой версии эти функции переезжают на сервер и превращаются
   в TopicMastery / DailyActivity / TaskNumberStats из доменной модели —
   сигнатуры специально совпадают с именами таблиц.
   ═══════════════════════════════════════════════════════════════════ */
window.Core = (function () {
  const db = DB.load();
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

  const studentUser = sid => user((student(sid) || {}).userId);
  const enrollmentsOf = sid => db.enrollments.filter(e => e.studentId === sid);
  const enrollmentIds = sid => enrollmentsOf(sid).map(e => e.id);
  const goalOf = sid => db.goals.find(g => g.studentId === sid) || null;
  const subscriptionOf = sid => db.subscriptions.find(s => s.studentId === sid) || null;
  const tutorOf = sid => {
    const e = enrollmentsOf(sid)[0];
    if (!e) return null;
    const tp = byId(db.tutorProfiles, e.tutorId);
    return tp ? { profile: tp, user: user(tp.userId) } : null;
  };
  const childrenOf = parentUserId =>
    db.guardians.filter(g => g.parentUserId === parentUserId && g.status === 'confirmed')
      .map(g => g.studentId);
  const studentsOfTutor = tutorProfileId =>
    db.enrollments.filter(e => e.tutorId === tutorProfileId).map(e => e.studentId);

  /* ── занятия ─────────────────────────────────────────────────── */
  function lessonsOf(sid) {
    const ids = enrollmentIds(sid);
    return db.lessons.filter(l => ids.includes(l.enrollmentId))
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }
  function nextLesson(sid) {
    const now = Date.now();
    return lessonsOf(sid).find(l => l.status === 'planned' && new Date(l.startsAt).getTime() > now - 90 * 60000) || null;
  }
  function lessonIsLive(l) {
    if (!l) return false;
    const s = new Date(l.startsAt).getTime();
    return Date.now() >= s - 10 * 60000 && Date.now() <= s + l.durationMin * 60000;
  }
  function studentOfLesson(l) {
    const e = byId(db.enrollments, l.enrollmentId);
    return e ? e.studentId : null;
  }

  /* ── попытки ─────────────────────────────────────────────────── */
  const attemptsOf = sid => db.attempts.filter(a => a.studentId === sid);
  const attemptsOfAssignment = aid => db.attempts.filter(a => a.assignmentId === aid);
  const attemptsOfLesson = lid => db.attempts.filter(a => a.lessonId === lid);
  const attemptFor = (sid, taskId, scope) => db.attempts.find(a =>
    a.studentId === sid && a.taskId === taskId &&
    (scope && scope.assignmentId ? a.assignmentId === scope.assignmentId : true) &&
    (scope && scope.lessonId ? a.lessonId === scope.lessonId : true));

  const attemptDate = a => a.submittedAt || a.startedAt || null;
  const isDone = a => a.status === 'checked' || a.status === 'submitted';

  /* ── домашние задания ────────────────────────────────────────── */
  function assignmentsOf(sid) {
    const ids = enrollmentIds(sid);
    return db.assignments.filter(a => ids.includes(a.enrollmentId)).map(decorateAssignment)
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  }

  function decorateAssignment(a) {
    const att = attemptsOfAssignment(a.id);
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
      score: done ? Math.round((correct / Math.max(done, 1)) * 100) : null,
      daysLeft: Math.ceil((new Date(a.dueAt).getTime() - Date.now()) / DAY),
    });
  }

  const ASSIGNMENT_STATUS = {
    issued:      { label:'выдано',      cls:'b-grey'   },
    in_progress: { label:'в работе',    cls:'b-blue'   },
    submitted:   { label:'на проверке', cls:'b-amber'  },
    checked:     { label:'проверено',   cls:'b-green'  },
    overdue:     { label:'просрочено',  cls:'b-red'    },
  };

  /* ── проверка ответа (автопроверка из архитектуры) ───────────── */
  function normalize(v, t) {
    const s = String(v == null ? '' : v).trim();
    if (t.compare === 'ci') return s.toLowerCase().replace(/\s+/g, '');
    if (t.compare === 'set') return s.split(/[\s,;]+/).filter(Boolean).sort().join(' ');
    return s.replace(/\s+/g, ' ');
  }
  function checkAnswer(t, value) {
    if (!t || !t.autoCheck) return null;          /* ручная проверка */
    return normalize(value, t) === normalize(t.answer, t);
  }

  /* ── активность и серия ──────────────────────────────────────── */
  const dayKey = ts => { const x = new Date(ts); x.setHours(0, 0, 0, 0); return x.getTime(); };

  function dailyActivity(sid, days) {
    const map = new Map();
    attemptsOf(sid).forEach(a => {
      const dt = attemptDate(a);
      if (!dt || !isDone(a)) return;
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

  function streak(sid) {
    const days = dailyActivity(sid, 200);
    let n = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].solved > 0) n++;
      else if (i === days.length - 1) continue;   /* сегодня ещё может быть пустым */
      else break;
    }
    return n;
  }

  /* ── темы ────────────────────────────────────────────────────── */
  function topicMastery(sid) {
    const now = Date.now();
    const acc = new Map();
    attemptsOf(sid).forEach(a => {
      if (a.isCorrect === null || !isDone(a)) return;
      const t = task(a.taskId); if (!t) return;
      const dt = new Date(attemptDate(a)).getTime();
      const cur = acc.get(t.topicId) || { n:0, ok:0, n30:0, ok30:0, nPrev:0, okPrev:0, seconds:0 };
      cur.n++; cur.seconds += a.activeSeconds || 0;
      if (a.isCorrect) cur.ok++;
      if (now - dt <= 30 * DAY) { cur.n30++; if (a.isCorrect) cur.ok30++; }
      else if (now - dt <= 60 * DAY) { cur.nPrev++; if (a.isCorrect) cur.okPrev++; }
      acc.set(t.topicId, cur);
    });
    return db.topics.map(tp => {
      const c = acc.get(tp.id);
      if (!c || !c.n) return { topic: tp, hasData: false, percent: null, delta: null, n: 0 };
      const pct = Math.round((c.ok / c.n) * 100);
      const p30 = c.n30 ? (c.ok30 / c.n30) * 100 : null;
      const pPrev = c.nPrev ? (c.okPrev / c.nPrev) * 100 : null;
      return {
        topic: tp, hasData: true, percent: pct, n: c.n, seconds: c.seconds,
        delta: (p30 != null && pPrev != null) ? Math.round(p30 - pPrev) : null,
      };
    }).filter(x => x.hasData).sort((a, b) => a.percent - b.percent);
  }

  /* ── сводка по номерам заданий ЕГЭ ───────────────────────────────
     Это и есть TaskNumberStats: «№5 — 20 ч, 77%».
     ──────────────────────────────────────────────────────────────── */
  function taskNumberStats(sid, days) {
    const from = days ? Date.now() - days * DAY : 0;
    const acc = new Map();
    attemptsOf(sid).forEach(a => {
      if (!isDone(a) || a.isCorrect === null) return;
      const dt = attemptDate(a); if (!dt || new Date(dt).getTime() < from) return;
      const t = task(a.taskId); if (!t) return;
      const cur = acc.get(t.egeNumber) || { n:0, ok:0, first:0, seconds:0 };
      cur.n++; cur.seconds += a.activeSeconds || 0;
      if (a.isCorrect) cur.ok++;
      if (a.firstTryCorrect) cur.first++;
      acc.set(t.egeNumber, cur);
    });
    return [...acc.entries()].map(([egeNumber, c]) => ({
      egeNumber,
      topic: topic(db.egeTopic[egeNumber]),
      attempts: c.n,
      correct: c.ok,
      percent: Math.round((c.ok / c.n) * 100),
      firstTryPercent: Math.round((c.first / c.n) * 100),
      seconds: c.seconds,
      avgSeconds: Math.round(c.seconds / c.n),
    })).sort((a, b) => a.egeNumber - b.egeNumber);
  }

  /* ── посещаемость ────────────────────────────────────────────── */
  function attendance(sid, days) {
    const from = Date.now() - days * DAY;
    const ls = lessonsOf(sid).filter(l => new Date(l.startsAt).getTime() >= from && new Date(l.startsAt).getTime() <= Date.now());
    const c = { done:0, moved:0, missed:0, planned:0 };
    ls.forEach(l => { c[l.status] = (c[l.status] || 0) + 1; });
    const counted = c.done + c.moved + c.missed;
    return Object.assign(c, {
      total: counted,
      percent: counted ? Math.round((c.done / counted) * 100) : null,
      hours: Math.round(ls.filter(l => l.status === 'done').reduce((s, l) => s + l.durationMin, 0) / 60),
    });
  }

  /* ── пробники ────────────────────────────────────────────────── */
  function mockSeries(sid) {
    return db.mockExams.filter(m => m.studentId === sid)
      .map(m => {
        const primary = m.items.reduce((s, i) => s + i.got, 0);
        return {
          id: m.id, variant: m.variant, date: new Date(m.date),
          primary, primaryMax: m.items.reduce((s, i) => s + i.max, 0),
          score: db.EGE_SCALE[primary] || 0,      /* тестовый балл, как на экзамене */
          items: m.items,
        };
      })
      .sort((a, b) => a.date - b.date);
  }

  /* ── KPI кабинета ────────────────────────────────────────────── */
  function kpi(sid) {
    const week = dailyActivity(sid, 7);
    const solvedWeek = week.reduce((s, d) => s + d.solved, 0);
    const secondsWeek = week.reduce((s, d) => s + d.seconds, 0);
    const done = attemptsOf(sid).filter(a => isDone(a) && a.isCorrect !== null);
    const correct = done.filter(a => a.isCorrect).length;
    const asg = assignmentsOf(sid);
    const series = mockSeries(sid);
    return {
      accuracy: done.length ? Math.round((correct / done.length) * 100) : null,
      solvedWeek, secondsWeek,
      streak: streak(sid),
      overdue: asg.filter(a => a.status === 'overdue').length,
      solvedTotal: done.length,
      lastMock: series.length ? series[series.length - 1] : null,
      mockDelta: series.length > 1 ? series[series.length - 1].score - series[series.length - 2].score : null,
      hours: Math.round(attemptsOf(sid).reduce((s, a) => s + (a.activeSeconds || 0), 0) / 3600),
    };
  }

  function goalProgress(sid) {
    const g = goalOf(sid); if (!g) return null;
    const series = mockSeries(sid);
    const cur = series.length ? series[series.length - 1].score : null;
    const examMs = new Date(g.examDate).getTime() - Date.now();
    return {
      goal: g, current: cur, target: g.targetScore,
      percent: cur == null ? null : Math.min(100, Math.round((cur / g.targetScore) * 100)),
      left: cur == null ? null : Math.max(0, g.targetScore - cur),
      daysToExam: Math.max(0, Math.ceil(examMs / DAY)),
    };
  }

  /* ── ближайшие дела для главной ──────────────────────────────── */
  function upcoming(sid, limit) {
    const rows = [];
    assignmentsOf(sid).forEach(a => {
      if (a.status === 'checked') return;
      rows.push({ kind:'assignment', id:a.id, title:a.title, dueAt:a.dueAt, status:a.status, meta:a });
    });
    const nl = nextLesson(sid);
    if (nl) rows.push({ kind:'lesson', id:nl.id, title:'Занятие с репетитором', dueAt:nl.startsAt, status:'planned', meta:nl });
    return rows.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, limit || 5);
  }

  /* ── очередь проверки для репетитора ─────────────────────────── */
  function reviewQueue(tutorProfileId) {
    const sids = studentsOfTutor(tutorProfileId);
    const out = [];
    sids.forEach(sid => {
      attemptsOf(sid).filter(a => a.status === 'submitted').forEach(a => {
        out.push({ attempt: a, task: task(a.taskId), student: student(sid),
                   user: studentUser(sid),
                   assignment: a.assignmentId ? assignment(a.assignmentId) : null });
      });
    });
    return out.sort((a, b) => new Date(a.attempt.submittedAt) - new Date(b.attempt.submittedAt));
  }

  function tutorToday(tutorProfileId) {
    const eids = db.enrollments.filter(e => e.tutorId === tutorProfileId).map(e => e.id);
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const t1 = t0.getTime() + DAY;
    return db.lessons.filter(l => eids.includes(l.enrollmentId))
      .filter(l => { const t = new Date(l.startsAt).getTime(); return t >= t0.getTime() && t < t1; })
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }

  /* ── мутации ─────────────────────────────────────────────────── */
  function saveAttempt(id, patch) {
    const a = attempt(id); if (!a) return null;
    Object.assign(a, patch);
    DB.save();
    return a;
  }
  function ensureAttempt(sid, taskId, scope) {
    let a = attemptFor(sid, taskId, scope);
    if (a) return a;
    a = {
      id: 'at-' + Math.random().toString(36).slice(2, 9),
      taskId, studentId: sid,
      context: scope && scope.lessonId ? 'lesson' : 'homework',
      lessonId: (scope && scope.lessonId) || null,
      assignmentId: (scope && scope.assignmentId) || null,
      code: '', answer: '', tries: 0, isCorrect: null, firstTryCorrect: null,
      activeSeconds: 0, status: 'issued', startedAt: null, submittedAt: null,
    };
    db.attempts.push(a); DB.save();
    return a;
  }

  /* ── форматирование ──────────────────────────────────────────── */
  const RU = 'ru-RU';
  const pad = n => String(n).padStart(2, '0');
  const fmtTime = ts => { const x = new Date(ts); return pad(x.getHours()) + ':' + pad(x.getMinutes()); };
  const fmtDate = ts => new Date(ts).toLocaleDateString(RU, { day:'numeric', month:'short' });
  const fmtDateFull = ts => new Date(ts).toLocaleDateString(RU, { weekday:'long', day:'numeric', month:'long' });
  const fmtDateTime = ts => fmtDate(ts) + ', ' + fmtTime(ts);

  function relDay(ts) {
    const k = dayKey(ts), t = dayKey(Date.now());
    const diff = Math.round((k - t) / DAY);
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
  const fmtDurSplit = splitDur;
  const fmtMoney = n => new Intl.NumberFormat(RU).format(n) + ' ₽';

  return {
    db, DAY,
    task, topic, user, student, lesson, assignment, attempt,
    studentUser, enrollmentsOf, goalOf, subscriptionOf, tutorOf, childrenOf, studentsOfTutor,
    lessonsOf, nextLesson, lessonIsLive, studentOfLesson,
    attemptsOf, attemptsOfAssignment, attemptsOfLesson, attemptFor, attemptDate, isDone,
    assignmentsOf, decorateAssignment, ASSIGNMENT_STATUS,
    checkAnswer, dailyActivity, streak, topicMastery, taskNumberStats,
    attendance, mockSeries, kpi, goalProgress, upcoming, reviewQueue, tutorToday,
    saveAttempt, ensureAttempt,
    fmtTime, fmtDate, fmtDateFull, fmtDateTime, relDay, plural, fmtDur, fmtDurShort, fmtDurSplit, fmtMoney,
  };
})();
