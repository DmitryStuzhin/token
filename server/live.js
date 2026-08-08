/* ═══════════════════════════════════════════════════════════════════
   ЖИВАЯ СЕССИЯ ЗАНЯТИЯ

   Комната на занятие: lesson:{id}. Ученик шлёт черновик обычными
   POST-запросами (heartbeat), сервер рассылает снимок репетитору
   по WebSocket. Поток односторонний — совместное редактирование
   не нужно, поэтому ни CRDT, ни Yjs здесь нет.

   Подключение авторизуется той же сессионной кукой, что и HTTP:
   в комнату пускают только репетитора этого занятия и его учеников.
   ═══════════════════════════════════════════════════════════════════ */
const { WebSocketServer } = require('ws');
const { db, all, one, rows } = require('./db.js');
const A = require('./auth.js');

function create(server) {
  const wss = new WebSocketServer({ noServer: true });
  const roomsByLesson = new Map();      /* lessonId → Set<ws> */

  function join(lessonId, ws) {
    if (!roomsByLesson.has(lessonId)) roomsByLesson.set(lessonId, new Set());
    roomsByLesson.get(lessonId).add(ws);
  }
  function leave(lessonId, ws) {
    const r = roomsByLesson.get(lessonId);
    if (!r) return;
    r.delete(ws);
    if (!r.size) roomsByLesson.delete(lessonId);
  }

  function snapshotOf(lessonId, studentId) {
    const l = one('SELECT * FROM lessons WHERE id = ?', lessonId);
    if (!l) return null;
    const ids = JSON.parse(l.task_ids || '[]');
    if (!ids.length) return { lessonId, studentId, attempts: [] };
    const ph = ids.map(() => '?').join(',');
    const attempts = all(
      `SELECT * FROM attempts WHERE lesson_id = ? AND student_id = ? AND task_id IN (${ph})`,
      lessonId, studentId, ...ids
    ).map(rows.rowAttempt)
     .map(a => ({ id:a.id, taskId:a.taskId, code:a.code, answer:a.answer, tries:a.tries,
                  isCorrect:a.isCorrect, activeSeconds:a.activeSeconds, status:a.status }));
    return { lessonId, studentId, attempts, at: new Date().toISOString() };
  }

  /* вызывается из API после каждого heartbeat и ответа */
  function push(lessonId, studentId) {
    if (!lessonId) return;
    const room = roomsByLesson.get(lessonId);
    if (!room || !room.size) return;
    const payload = snapshotOf(lessonId, studentId);
    if (!payload) return;
    const msg = JSON.stringify({ type:'snapshot', ...payload });
    room.forEach(ws => {
      /* ученику своё же эхо не нужно, отдаём только наблюдателям */
      if (ws.readyState === ws.OPEN && ws.role === 'tutor') ws.send(msg);
    });
  }

  function presence(lessonId) {
    const room = roomsByLesson.get(lessonId);
    if (!room) return;
    const who = [...room].map(ws => ({ role:ws.role, name:ws.userName }));
    const msg = JSON.stringify({ type:'presence', lessonId, who });
    room.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(msg); });
  }

  /* ── апгрейд соединения с проверкой прав ──────────────────────── */
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return socket.destroy(); }
    if (url.pathname !== '/live') return socket.destroy();

    const raw = req.headers.cookie || '';
    const c = raw.split(';').map(s => s.trim()).find(s => s.startsWith(A.COOKIE + '='));
    const user = A.userBySession(c ? decodeURIComponent(c.slice(A.COOKIE.length + 1)) : null);
    if (!user) return socket.destroy();

    const lessonId = url.searchParams.get('lesson');
    const l = one('SELECT * FROM lessons WHERE id = ?', lessonId);
    if (!l) return socket.destroy();

    const profile = A.profileOf(user);
    let allowed = false;
    if (user.role === 'tutor' && profile && l.tutor_id === profile.id) allowed = true;
    if (user.role === 'student' && profile) {
      if (l.group_id) {
        allowed = !!one('SELECT 1 x FROM group_members WHERE group_id = ? AND student_id = ? AND status = ?',
          l.group_id, profile.id, 'active');
      } else {
        const e = one('SELECT * FROM enrollments WHERE id = ?', l.enrollment_id);
        allowed = !!(e && e.student_id === profile.id);
      }
    }
    if (!allowed) return socket.destroy();

    wss.handleUpgrade(req, socket, head, ws => {
      ws.role = user.role;
      ws.userName = user.name;
      ws.lessonId = lessonId;
      ws.studentId = user.role === 'student' && profile ? profile.id : null;
      join(lessonId, ws);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', ws => {
    presence(ws.lessonId);
    /* репетитор при подключении сразу получает текущее состояние */
    if (ws.role === 'tutor') {
      const l = one('SELECT * FROM lessons WHERE id = ?', ws.lessonId);
      const students = l && l.group_id
        ? all('SELECT student_id FROM group_members WHERE group_id = ? AND status = ?', l.group_id, 'active').map(r => r.student_id)
        : (() => { const e = one('SELECT * FROM enrollments WHERE id = ?', l && l.enrollment_id); return e ? [e.student_id] : []; })();
      students.forEach(sid => {
        const p = snapshotOf(ws.lessonId, sid);
        if (p) ws.send(JSON.stringify({ type:'snapshot', ...p }));
      });
    }

    ws.on('message', buf => {
      let msg = null;
      try { msg = JSON.parse(String(buf)); } catch (e) { return; }
      /* ученик может попросить разослать своё состояние немедленно */
      if (msg && msg.type === 'ping' && ws.role === 'student' && ws.studentId) {
        push(ws.lessonId, ws.studentId);
      }
    });

    ws.on('close', () => { leave(ws.lessonId, ws); presence(ws.lessonId); });
    ws.on('error', () => { leave(ws.lessonId, ws); });
  });

  return { push, presence, rooms: roomsByLesson };
}

module.exports = { create };
